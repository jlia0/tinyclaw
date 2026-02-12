//! Pattern-based DSL resolution rules.
//!
//! Implements a domain-specific language for common merge conflict resolution
//! patterns, inspired by the program synthesis approach from Svyatkovskiy et al.
//! (ICSE 2021) which found that ~28% of merge conflicts follow repetitive patterns
//! and ~41% of 1-2 line changes can be resolved by a DSL.
//!
//! Instead of learning patterns via synthesis, we encode the most common resolution
//! patterns as declarative rules. Each rule has:
//! - A **predicate** that checks if the conflict matches the pattern
//! - A **transform** that produces the resolution
//!
//! Common patterns from the literature:
//! 1. Both sides add imports/includes → keep both (union)
//! 2. Both sides modify the same value → prefer longer/more specific
//! 3. One side adds, other modifies → combine additions
//! 4. Adjacent-line edits (false conflict) → concatenate
//! 5. Whitespace/formatting only differences → pick either
//! 6. Both sides add to a list → interleave or concatenate
//! 7. Identical deletions → accept deletion

use crate::types::{Confidence, MergeScenario, ResolutionCandidate, ResolutionStrategy};

/// A pattern rule that can match and resolve a conflict.
pub trait PatternRule: Send + Sync {
    /// Human-readable name for the rule.
    fn name(&self) -> &str;

    /// Check if this rule matches the given conflict scenario.
    fn matches(&self, scenario: &MergeScenario<&str>) -> bool;

    /// Produce a resolution. Only called if `matches` returned true.
    fn resolve(&self, scenario: &MergeScenario<&str>) -> String;

    /// Confidence level of this rule's resolution.
    fn confidence(&self) -> Confidence;
}

/// Registry of all pattern rules.
pub struct PatternRegistry {
    rules: Vec<Box<dyn PatternRule>>,
}

impl PatternRegistry {
    /// Create a registry with all built-in rules.
    pub fn new() -> Self {
        Self {
            rules: vec![
                Box::new(WhitespaceOnlyRule),
                Box::new(IdenticalChangeRule),
                Box::new(BothAddLinesRule),
                Box::new(OneEmptyRule),
                Box::new(PrefixSuffixRule),
                Box::new(ImportUnionRule),
                Box::new(AdjacentEditRule),
            ],
        }
    }

    /// Try all rules against a conflict, returning the first match.
    pub fn try_resolve(
        &self,
        scenario: &MergeScenario<&str>,
    ) -> Option<ResolutionCandidate> {
        for rule in &self.rules {
            if rule.matches(scenario) {
                return Some(ResolutionCandidate {
                    content: rule.resolve(scenario),
                    confidence: rule.confidence(),
                    strategy: ResolutionStrategy::PatternRule,
                });
            }
        }
        None
    }

    /// Try all rules and return ALL matching resolutions, not just the first.
    pub fn try_resolve_all(
        &self,
        scenario: &MergeScenario<&str>,
    ) -> Vec<ResolutionCandidate> {
        self.rules
            .iter()
            .filter(|rule| rule.matches(scenario))
            .map(|rule| ResolutionCandidate {
                content: rule.resolve(scenario),
                confidence: rule.confidence(),
                strategy: ResolutionStrategy::PatternRule,
            })
            .collect()
    }
}

impl Default for PatternRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 1: Whitespace-only differences
// ──────────────────────────────────────────────────────────────

/// If the conflict is only whitespace/formatting differences, pick left.
struct WhitespaceOnlyRule;

impl PatternRule for WhitespaceOnlyRule {
    fn name(&self) -> &str {
        "whitespace-only"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        let base_norm = normalize_whitespace(scenario.base);
        let left_norm = normalize_whitespace(scenario.left);
        let right_norm = normalize_whitespace(scenario.right);
        // If all three are the same after whitespace normalization, it's a false conflict
        base_norm == left_norm && base_norm == right_norm
            || left_norm == right_norm
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        // Prefer the version with more intentional formatting (left by convention)
        scenario.left.to_string()
    }

    fn confidence(&self) -> Confidence {
        Confidence::High
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 2: Identical changes from both sides
// ──────────────────────────────────────────────────────────────

/// Both sides made the exact same change — just accept it.
struct IdenticalChangeRule;

impl PatternRule for IdenticalChangeRule {
    fn name(&self) -> &str {
        "identical-change"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        scenario.left == scenario.right && scenario.left != scenario.base
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        scenario.left.to_string()
    }

    fn confidence(&self) -> Confidence {
        Confidence::High
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 3: Both sides add new lines (no modification to base)
// ──────────────────────────────────────────────────────────────

/// Both sides added lines while the base is empty or both additions start
/// after the base content. Concatenate both additions.
struct BothAddLinesRule;

impl PatternRule for BothAddLinesRule {
    fn name(&self) -> &str {
        "both-add-lines"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        let base = scenario.base.trim();
        if !base.is_empty() {
            return false;
        }
        // Both sides are purely additions
        !scenario.left.trim().is_empty() && !scenario.right.trim().is_empty()
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        let mut result = scenario.left.to_string();
        if !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str(scenario.right);
        result
    }

    fn confidence(&self) -> Confidence {
        Confidence::Medium
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 4: One side is empty (deletion vs. modification)
// ──────────────────────────────────────────────────────────────

/// One side deleted the content while the other modified it.
/// Accept the modification (prefer data preservation).
struct OneEmptyRule;

impl PatternRule for OneEmptyRule {
    fn name(&self) -> &str {
        "one-empty"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        let left_empty = scenario.left.trim().is_empty();
        let right_empty = scenario.right.trim().is_empty();
        (left_empty && !right_empty) || (!left_empty && right_empty)
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        if scenario.left.trim().is_empty() {
            scenario.right.to_string()
        } else {
            scenario.left.to_string()
        }
    }

    fn confidence(&self) -> Confidence {
        Confidence::Medium
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 5: One side is a prefix/suffix of the other
// ──────────────────────────────────────────────────────────────

/// If one side's change is a prefix or suffix of the other, take the longer one.
/// This captures the common pattern where both sides extend the same code
/// but one went further.
struct PrefixSuffixRule;

impl PatternRule for PrefixSuffixRule {
    fn name(&self) -> &str {
        "prefix-suffix"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        let left = scenario.left.trim();
        let right = scenario.right.trim();
        if left == right {
            return false;
        }
        left.starts_with(right)
            || right.starts_with(left)
            || left.ends_with(right)
            || right.ends_with(left)
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        let left = scenario.left.trim();
        let right = scenario.right.trim();
        // Take the longer (more complete) version
        if left.len() >= right.len() {
            scenario.left.to_string()
        } else {
            scenario.right.to_string()
        }
    }

    fn confidence(&self) -> Confidence {
        Confidence::Medium
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 6: Import/include union
// ──────────────────────────────────────────────────────────────

/// Both sides added different import/include/use statements.
/// Take the union (deduplicated, sorted).
struct ImportUnionRule;

impl PatternRule for ImportUnionRule {
    fn name(&self) -> &str {
        "import-union"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        // Check if all non-empty lines look like import/use/include statements
        let all_imports = |text: &str| {
            text.lines()
                .filter(|l| !l.trim().is_empty())
                .all(|l| is_import_line(l))
        };
        all_imports(scenario.base) && all_imports(scenario.left) && all_imports(scenario.right)
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        let mut imports: Vec<String> = Vec::new();

        // Collect all unique imports from both sides
        for line in scenario.left.lines().chain(scenario.right.lines()) {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() && !imports.contains(&trimmed) {
                imports.push(trimmed);
            }
        }

        imports.sort();
        imports.join("\n")
    }

    fn confidence(&self) -> Confidence {
        Confidence::High
    }
}

// ──────────────────────────────────────────────────────────────
// Rule 7: Adjacent edits (different lines modified)
// ──────────────────────────────────────────────────────────────

/// Both sides edited different lines within the conflict region.
/// If we can identify which lines each side actually changed, interleave cleanly.
struct AdjacentEditRule;

impl PatternRule for AdjacentEditRule {
    fn name(&self) -> &str {
        "adjacent-edit"
    }

    fn matches(&self, scenario: &MergeScenario<&str>) -> bool {
        let base_lines: Vec<&str> = scenario.base.lines().collect();
        let left_lines: Vec<&str> = scenario.left.lines().collect();
        let right_lines: Vec<&str> = scenario.right.lines().collect();

        // Must have the same number of lines
        if base_lines.len() != left_lines.len() || base_lines.len() != right_lines.len() {
            return false;
        }

        // Each line should be changed by at most one side
        for i in 0..base_lines.len() {
            let left_changed = base_lines[i] != left_lines[i];
            let right_changed = base_lines[i] != right_lines[i];
            if left_changed && right_changed {
                return false;
            }
        }

        // At least one line changed on each side
        let left_has_changes = base_lines.iter().zip(left_lines.iter()).any(|(b, l)| b != l);
        let right_has_changes = base_lines
            .iter()
            .zip(right_lines.iter())
            .any(|(b, r)| b != r);
        left_has_changes && right_has_changes
    }

    fn resolve(&self, scenario: &MergeScenario<&str>) -> String {
        let base_lines: Vec<&str> = scenario.base.lines().collect();
        let left_lines: Vec<&str> = scenario.left.lines().collect();
        let right_lines: Vec<&str> = scenario.right.lines().collect();

        let mut result = Vec::new();
        for i in 0..base_lines.len() {
            if base_lines[i] != left_lines[i] {
                result.push(left_lines[i]);
            } else if base_lines[i] != right_lines[i] {
                result.push(right_lines[i]);
            } else {
                result.push(base_lines[i]);
            }
        }

        result.join("\n")
    }

    fn confidence(&self) -> Confidence {
        Confidence::High
    }
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

fn normalize_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_import_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("import ")
        || trimmed.starts_with("from ")
        || trimmed.starts_with("use ")
        || trimmed.starts_with("#include")
        || trimmed.starts_with("require(")
        || trimmed.starts_with("const ")
            && (trimmed.contains("require(") || trimmed.contains("import("))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_whitespace_only() {
        let scenario = MergeScenario::new(
            "int x = 1;",
            "int  x = 1;",  // extra space
            "int x  = 1;",  // different extra space
        );
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        assert_eq!(result.unwrap().confidence, Confidence::High);
    }

    #[test]
    fn test_identical_change() {
        let scenario = MergeScenario::new("old", "new", "new");
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        assert_eq!(result.unwrap().content, "new");
    }

    #[test]
    fn test_both_add_lines() {
        let scenario = MergeScenario::new("", "line_a", "line_b");
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        assert!(result.unwrap().content.contains("line_a"));
    }

    #[test]
    fn test_import_union() {
        let scenario = MergeScenario::new(
            "import a\nimport b",
            "import a\nimport b\nimport c",
            "import a\nimport b\nimport d",
        );
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        let content = result.unwrap().content;
        assert!(content.contains("import c"));
        assert!(content.contains("import d"));
    }

    #[test]
    fn test_adjacent_edit() {
        let scenario = MergeScenario::new(
            "line1\nline2\nline3",
            "modified1\nline2\nline3",
            "line1\nline2\nmodified3",
        );
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        let content = result.unwrap().content;
        assert!(content.contains("modified1"));
        assert!(content.contains("modified3"));
    }

    #[test]
    fn test_prefix_suffix() {
        let scenario = MergeScenario::new("base", "extended_base", "extended_base_more");
        let registry = PatternRegistry::new();
        let result = registry.try_resolve(&scenario);
        assert!(result.is_some());
        assert!(result.unwrap().content.contains("extended_base_more"));
    }
}
