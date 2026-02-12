//! Main conflict resolver pipeline.
//!
//! Orchestrates the multi-strategy resolution approach, applying techniques
//! in order of confidence from highest to lowest:
//!
//! 1. **Pattern rules** (DSL) — highest confidence, instant (ICSE 2021)
//! 2. **Structured merge** (tree-level) — eliminates false conflicts (LASTMERGE 2025)
//! 3. **Version Space Algebra** — enumerates combinations (OOPSLA 2018)
//! 4. **Search-based** — evolutionary with parent similarity (TOSEM 2025)
//!
//! The resolver stops at the first strategy that produces a resolution with
//! sufficient confidence, or returns ranked candidates from all strategies.

use crate::amalgamator::{amalgam_to_merge_result, amalgamate, AmalgamResult};
use crate::diff3;
use crate::parser::{self, ParseError};
use crate::patterns::PatternRegistry;
use crate::search::{self, SearchConfig};
use crate::types::*;
use crate::vsa;

/// Configuration for the resolver pipeline.
pub struct ResolverConfig {
    /// Minimum confidence to auto-accept a resolution.
    pub auto_accept_threshold: Confidence,
    /// Maximum VSA candidates to enumerate.
    pub max_vsa_candidates: usize,
    /// Search-based resolver configuration.
    pub search_config: SearchConfig,
    /// Programming language (for structured merge). None = text-only mode.
    pub language: Option<Language>,
}

impl Default for ResolverConfig {
    fn default() -> Self {
        Self {
            auto_accept_threshold: Confidence::Medium,
            max_vsa_candidates: 100,
            search_config: SearchConfig::default(),
            language: None,
        }
    }
}

/// The main resolver that combines all strategies.
pub struct Resolver {
    config: ResolverConfig,
    patterns: PatternRegistry,
}

/// Result of the full resolution pipeline.
#[derive(Debug)]
pub struct ResolverOutput {
    /// The best resolution, if any strategy produced one above threshold.
    pub resolution: Option<ResolutionCandidate>,
    /// All candidate resolutions, ranked by confidence.
    pub candidates: Vec<ResolutionCandidate>,
    /// Which strategies were attempted.
    pub strategies_tried: Vec<ResolutionStrategy>,
    /// The original merge result (possibly a conflict).
    pub diff3_result: MergeResult,
}

impl Resolver {
    pub fn new(config: ResolverConfig) -> Self {
        Self {
            config,
            patterns: PatternRegistry::new(),
        }
    }

    /// Resolve a three-way merge for complete file contents.
    ///
    /// This is the main entry point. It first runs diff3 to identify conflict
    /// regions, then applies the resolution pipeline to each conflict.
    pub fn resolve_file(
        &self,
        base: &str,
        left: &str,
        right: &str,
    ) -> FileResolverOutput {
        let scenario = MergeScenario::new(base, left, right);
        let diff3_result = diff3::diff3_merge(&scenario);

        match &diff3_result {
            MergeResult::Resolved(content) => {
                // No conflicts — diff3 handled it
                FileResolverOutput {
                    merged_content: content.clone(),
                    conflicts: vec![],
                    all_resolved: true,
                }
            }
            MergeResult::Conflict { .. } => {
                // Extract individual conflict regions and resolve each
                let _conflicts = diff3::extract_conflicts(&scenario);
                let mut merged_parts = Vec::new();
                let mut unresolved = Vec::new();
                let mut all_resolved = true;

                // Re-run diff3 to get hunks for reconstruction
                let hunks = diff3::diff3_hunks(&scenario);

                for hunk in &hunks {
                    match hunk {
                        Diff3Hunk::Stable(lines) | Diff3Hunk::LeftChanged(lines) | Diff3Hunk::RightChanged(lines) => {
                            for line in lines {
                                merged_parts.push(line.clone());
                            }
                        }
                        Diff3Hunk::Conflict { base, left, right } => {
                            let conflict_scenario = MergeScenario::new(
                                base.join("\n").as_str().to_string(),
                                left.join("\n").as_str().to_string(),
                                right.join("\n").as_str().to_string(),
                            );

                            let output = self.resolve_conflict(
                                &conflict_scenario.base,
                                &conflict_scenario.left,
                                &conflict_scenario.right,
                            );

                            if let Some(ref resolution) = output.resolution {
                                for line in resolution.content.lines() {
                                    merged_parts.push(line.to_string());
                                }
                            } else {
                                all_resolved = false;
                                // Insert conflict markers
                                merged_parts.push("<<<<<<< LEFT".to_string());
                                merged_parts.extend(left.iter().cloned());
                                merged_parts.push("||||||| BASE".to_string());
                                merged_parts.extend(base.iter().cloned());
                                merged_parts.push("=======".to_string());
                                merged_parts.extend(right.iter().cloned());
                                merged_parts.push(">>>>>>> RIGHT".to_string());
                            }
                            unresolved.push(output);
                        }
                    }
                }

                FileResolverOutput {
                    merged_content: merged_parts.join("\n"),
                    conflicts: unresolved,
                    all_resolved,
                }
            }
        }
    }

    /// Resolve a single conflict region using the full pipeline.
    pub fn resolve_conflict(
        &self,
        base: &str,
        left: &str,
        right: &str,
    ) -> ResolverOutput {
        let mut candidates: Vec<ResolutionCandidate> = Vec::new();
        let mut strategies_tried = Vec::new();

        let text_scenario = MergeScenario::new(base, left, right);
        let diff3_result = diff3::diff3_merge(&text_scenario);

        // ── Strategy 1: Pattern-based DSL rules ──
        strategies_tried.push(ResolutionStrategy::PatternRule);
        if let Some(resolution) = self.patterns.try_resolve(&text_scenario) {
            if resolution.confidence >= self.config.auto_accept_threshold {
                return ResolverOutput {
                    resolution: Some(resolution.clone()),
                    candidates: vec![resolution],
                    strategies_tried,
                    diff3_result,
                };
            }
            candidates.push(resolution);
        }

        // ── Strategy 2: Structured tree merge ──
        if let Some(lang) = self.config.language {
            strategies_tried.push(ResolutionStrategy::StructuredMerge);
            match self.try_structured_merge(base, left, right, lang) {
                Ok(Some(result)) => {
                    if let MergeResult::Resolved(content) = result {
                        let resolution = ResolutionCandidate {
                            content,
                            confidence: Confidence::High,
                            strategy: ResolutionStrategy::StructuredMerge,
                        };
                        if resolution.confidence >= self.config.auto_accept_threshold {
                            return ResolverOutput {
                                resolution: Some(resolution.clone()),
                                candidates: vec![resolution],
                                strategies_tried,
                                diff3_result,
                            };
                        }
                        candidates.push(resolution);
                    }
                }
                Ok(None) => {} // Structured merge also found a conflict
                Err(_) => {}   // Parse error — skip this strategy
            }
        }

        // ── Strategy 3: Version Space Algebra ──
        if let Some(lang) = self.config.language {
            strategies_tried.push(ResolutionStrategy::VersionSpaceAlgebra);
            if let Ok(vsa_candidates) = self.try_vsa_resolve(base, left, right, lang) {
                candidates.extend(vsa_candidates);
            }
        }

        // ── Strategy 4: Search-based resolution ──
        strategies_tried.push(ResolutionStrategy::SearchBased);
        let search_candidates =
            search::search_resolve(&text_scenario, &self.config.search_config);
        candidates.extend(search_candidates);

        // Sort all candidates by confidence
        candidates.sort_by(|a, b| b.confidence.cmp(&a.confidence));

        // Deduplicate by content
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|c| seen.insert(c.content.clone()));

        let resolution = candidates
            .first()
            .filter(|c| c.confidence >= self.config.auto_accept_threshold)
            .cloned();

        ResolverOutput {
            resolution,
            candidates,
            strategies_tried,
            diff3_result,
        }
    }

    /// Attempt structured tree merge for a conflict region.
    fn try_structured_merge(
        &self,
        base: &str,
        left: &str,
        right: &str,
        lang: Language,
    ) -> Result<Option<MergeResult>, ParseError> {
        let base_tree = parser::parse_to_cst(base, lang)?;
        let left_tree = parser::parse_to_cst(left, lang)?;
        let right_tree = parser::parse_to_cst(right, lang)?;

        let scenario = MergeScenario::new(&base_tree, &left_tree, &right_tree);
        let result = amalgamate(&scenario);

        match result {
            AmalgamResult::Merged(_) => Ok(Some(amalgam_to_merge_result(&result))),
            AmalgamResult::Conflict { .. } => Ok(None),
        }
    }

    /// Attempt VSA resolution for a conflict region.
    fn try_vsa_resolve(
        &self,
        base: &str,
        left: &str,
        right: &str,
        lang: Language,
    ) -> Result<Vec<ResolutionCandidate>, ParseError> {
        let base_tree = parser::parse_to_cst(base, lang)?;
        let left_tree = parser::parse_to_cst(left, lang)?;
        let right_tree = parser::parse_to_cst(right, lang)?;

        let scenario = MergeScenario::new(&base_tree, &left_tree, &right_tree);
        Ok(vsa::resolve_via_vsa(&scenario, self.config.max_vsa_candidates))
    }
}

/// Output of resolving a complete file.
#[derive(Debug)]
pub struct FileResolverOutput {
    /// The merged file content (may contain conflict markers if not fully resolved).
    pub merged_content: String,
    /// Per-conflict resolution details.
    pub conflicts: Vec<ResolverOutput>,
    /// Whether all conflicts were resolved.
    pub all_resolved: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_merge() {
        let resolver = Resolver::new(ResolverConfig::default());
        let result = resolver.resolve_file(
            "line1\nline2\nline3\n",
            "lineA\nline2\nline3\n",
            "line1\nline2\nlineC\n",
        );
        assert!(result.all_resolved);
    }

    #[test]
    fn test_pattern_resolves_whitespace() {
        let resolver = Resolver::new(ResolverConfig::default());
        let output = resolver.resolve_conflict(
            "int x = 1;",
            "int  x = 1;",
            "int x  = 1;",
        );
        assert!(output.resolution.is_some());
        assert_eq!(
            output.resolution.unwrap().strategy,
            ResolutionStrategy::PatternRule
        );
    }

    #[test]
    fn test_search_fallback() {
        let resolver = Resolver::new(ResolverConfig::default());
        let output = resolver.resolve_conflict(
            "fn foo() { return 1; }",
            "fn foo() { return 2; }",
            "fn bar() { return 1; }",
        );
        // Should have candidates even for hard conflicts
        assert!(!output.candidates.is_empty());
    }

    #[test]
    fn test_structured_merge_rust() {
        let config = ResolverConfig {
            language: Some(Language::Rust),
            ..Default::default()
        };
        let resolver = Resolver::new(config);
        let output = resolver.resolve_conflict(
            "fn main() { let x = 1; }",
            "fn main() { let x = 2; }",
            "fn main() { let x = 1; let y = 3; }",
        );
        // Should attempt structured merge
        assert!(output.strategies_tried.contains(&ResolutionStrategy::StructuredMerge));
    }
}
