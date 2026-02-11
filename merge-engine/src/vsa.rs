//! Version Space Algebra (VSA) for merge conflict resolution.
//!
//! Implements the approach from Zhu & He (OOPSLA 2018) / AutoMerge.
//! When structured merge detects a conflict, VSA enumerates all possible
//! resolution candidates by combining edit operations from both sides.
//!
//! The three-kind taxonomy of AST nodes maps to VSA as follows:
//! - **Leaf**: trivially a single-element version space
//! - **Constructed node**: cross-product (Join) of children version spaces
//! - **List node**: extended with List Join for variable-length combinations
//!
//! Candidates are ranked by parent similarity (Campos Junior et al., TOSEM 2025)
//! and enumerated lazily from highest to lowest score.

use crate::matcher::tree_similarity;
use crate::types::{CstNode, Confidence, ListOrdering, MergeScenario, ResolutionCandidate, ResolutionStrategy};

/// A version space representing a set of possible AST subtrees.
#[derive(Debug, Clone)]
pub enum VersionSpace {
    /// A single concrete tree (leaf of the version space).
    Atom(CstNode),
    /// Cross product: pick one child from each sub-space.
    Join {
        kind: String,
        children: Vec<VersionSpace>,
    },
    /// Union: pick from either sub-space.
    Union(Vec<VersionSpace>),
    /// List join: ordered combination of sub-spaces, allowing interleaving.
    ListJoin {
        kind: String,
        ordering: ListOrdering,
        left_items: Vec<VersionSpace>,
        right_items: Vec<VersionSpace>,
        base_items: Vec<VersionSpace>,
    },
}

impl VersionSpace {
    /// Count the total number of candidate programs in this version space.
    /// Returns None if the count is too large (> threshold).
    pub fn count(&self, max: usize) -> Option<usize> {
        match self {
            VersionSpace::Atom(_) => Some(1),
            VersionSpace::Join { children, .. } => {
                let mut total = 1usize;
                for child in children {
                    let c = child.count(max)?;
                    total = total.checked_mul(c)?;
                    if total > max {
                        return None;
                    }
                }
                Some(total)
            }
            VersionSpace::Union(options) => {
                let mut total = 0usize;
                for opt in options {
                    let c = opt.count(max)?;
                    total = total.checked_add(c)?;
                    if total > max {
                        return None;
                    }
                }
                Some(total)
            }
            VersionSpace::ListJoin { left_items, right_items, base_items, .. } => {
                // Conservative estimate: each list merge has multiple interleavings
                let n = left_items.len() + right_items.len() + base_items.len();
                if n > 20 {
                    return None;
                }
                // Number of interleavings is bounded by C(l+r, l) * product of item counts
                Some(2usize.pow(n.min(30) as u32).min(max))
            }
        }
    }

    /// Enumerate all concrete trees in this version space, up to a limit.
    pub fn enumerate(&self, max: usize) -> Vec<CstNode> {
        let mut results = Vec::new();
        self.enumerate_inner(&mut results, max);
        results
    }

    fn enumerate_inner(&self, out: &mut Vec<CstNode>, max: usize) {
        if out.len() >= max {
            return;
        }
        match self {
            VersionSpace::Atom(node) => {
                out.push(node.clone());
            }
            VersionSpace::Join { kind, children } => {
                // Cross product of all children
                let child_options: Vec<Vec<CstNode>> = children
                    .iter()
                    .map(|c| c.enumerate(max))
                    .collect();

                let mut combos = vec![Vec::new()];
                for options in &child_options {
                    let mut new_combos = Vec::new();
                    for combo in &combos {
                        for opt in options {
                            if new_combos.len() >= max {
                                break;
                            }
                            let mut new_combo = combo.clone();
                            new_combo.push(opt.clone());
                            new_combos.push(new_combo);
                        }
                    }
                    combos = new_combos;
                }

                for combo in combos {
                    if out.len() >= max {
                        break;
                    }
                    out.push(CstNode::Constructed {
                        id: 0,
                        kind: kind.clone(),
                        children: combo,
                    });
                }
            }
            VersionSpace::Union(options) => {
                for opt in options {
                    if out.len() >= max {
                        break;
                    }
                    opt.enumerate_inner(out, max);
                }
            }
            VersionSpace::ListJoin {
                kind,
                ordering,
                left_items,
                right_items,
                base_items,
            } => {
                // Generate candidate lists by interleaving left and right additions
                // while preserving relative order within each side.
                let left_nodes: Vec<Vec<CstNode>> =
                    left_items.iter().map(|vs| vs.enumerate(max)).collect();
                let right_nodes: Vec<Vec<CstNode>> =
                    right_items.iter().map(|vs| vs.enumerate(max)).collect();
                let base_nodes: Vec<CstNode> = base_items
                    .iter()
                    .flat_map(|vs| vs.enumerate(1))
                    .collect();

                // Strategy 1: left before right
                let mut children1 = base_nodes.clone();
                for items in &left_nodes {
                    if let Some(item) = items.first() {
                        children1.push(item.clone());
                    }
                }
                for items in &right_nodes {
                    if let Some(item) = items.first() {
                        children1.push(item.clone());
                    }
                }
                out.push(CstNode::List {
                    id: 0,
                    kind: kind.clone(),
                    ordering: *ordering,
                    children: children1,
                });

                if out.len() < max {
                    // Strategy 2: right before left
                    let mut children2 = base_nodes;
                    for items in &right_nodes {
                        if let Some(item) = items.first() {
                            children2.push(item.clone());
                        }
                    }
                    for items in &left_nodes {
                        if let Some(item) = items.first() {
                            children2.push(item.clone());
                        }
                    }
                    out.push(CstNode::List {
                        id: 0,
                        kind: kind.clone(),
                        ordering: *ordering,
                        children: children2,
                    });
                }
            }
        }
    }
}

/// Construct a version space from a conflict scenario.
///
/// Given base, left, right subtrees that are in conflict, builds a VSA
/// that represents all plausible resolutions by combining edits from
/// both sides. Follows Zhu & He's conversion rules.
pub fn build_version_space(scenario: &MergeScenario<&CstNode>) -> VersionSpace {
    let base = scenario.base;
    let left = scenario.left;
    let right = scenario.right;

    // If both changed to the same thing, the version space is just that
    if left.structurally_equal(right) {
        return VersionSpace::Atom(left.clone());
    }

    // For leaf nodes: the space is the union of both alternatives
    if base.is_leaf() && left.is_leaf() && right.is_leaf() {
        return VersionSpace::Union(vec![
            VersionSpace::Atom(left.clone()),
            VersionSpace::Atom(right.clone()),
            VersionSpace::Atom(base.clone()),
        ]);
    }

    // For list nodes: use ListJoin to combine both sides' edits
    if !base.is_leaf() && !left.is_leaf() && !right.is_leaf() {
        let base_children = base.children();
        let left_children = left.children();
        let right_children = right.children();

        // Identify which children are shared vs. unique to each side
        let mut base_items = Vec::new();
        let mut left_only = Vec::new();
        let mut right_only = Vec::new();

        // Simple heuristic: classify children as base/left-only/right-only
        let mut left_matched = vec![false; left_children.len()];
        let mut right_matched = vec![false; right_children.len()];

        for bc in base_children {
            let in_left = left_children
                .iter()
                .enumerate()
                .find(|(i, lc)| !left_matched[*i] && bc.structurally_equal(lc));
            let in_right = right_children
                .iter()
                .enumerate()
                .find(|(i, rc)| !right_matched[*i] && bc.structurally_equal(rc));

            if let Some((li, _)) = in_left {
                left_matched[li] = true;
            }
            if let Some((ri, _)) = in_right {
                right_matched[ri] = true;
            }

            base_items.push(VersionSpace::Atom(bc.clone()));
        }

        for (i, lc) in left_children.iter().enumerate() {
            if !left_matched[i] {
                left_only.push(VersionSpace::Atom(lc.clone()));
            }
        }
        for (i, rc) in right_children.iter().enumerate() {
            if !right_matched[i] {
                right_only.push(VersionSpace::Atom(rc.clone()));
            }
        }

        let ordering = match base {
            CstNode::List { ordering, .. } => *ordering,
            _ => ListOrdering::Ordered,
        };

        return VersionSpace::ListJoin {
            kind: base.kind().to_string(),
            ordering,
            left_items: left_only,
            right_items: right_only,
            base_items,
        };
    }

    // Fallback: union of all three versions
    VersionSpace::Union(vec![
        VersionSpace::Atom(left.clone()),
        VersionSpace::Atom(right.clone()),
        VersionSpace::Atom(base.clone()),
    ])
}

/// Rank VSA candidates using parent similarity heuristic.
///
/// From Campos Junior et al. (TOSEM 2025): the correct resolution tends to
/// be similar to both parents (left and right). We score each candidate by
/// its combined similarity to both parents, normalized by the candidate's size.
pub fn rank_candidates(
    candidates: Vec<CstNode>,
    scenario: &MergeScenario<&CstNode>,
) -> Vec<ResolutionCandidate> {
    let mut scored: Vec<(CstNode, f64)> = candidates
        .into_iter()
        .map(|candidate| {
            let left_sim = tree_similarity(&candidate, scenario.left) as f64;
            let right_sim = tree_similarity(&candidate, scenario.right) as f64;
            let base_sim = tree_similarity(&candidate, scenario.base) as f64;

            // Parent similarity fitness function (Campos Junior 2025):
            // Maximize similarity to both parents while diverging from base
            // (since the resolution should incorporate changes, not revert to base)
            let parent_similarity = left_sim + right_sim;
            let base_penalty = base_sim * 0.5;
            let size_norm = candidate.size().max(1) as f64;

            let score = (parent_similarity - base_penalty) / size_norm;
            (candidate, score)
        })
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Remove duplicates
    let mut seen = Vec::new();
    scored.retain(|(candidate, _)| {
        let source = candidate.to_source();
        if seen.contains(&source) {
            false
        } else {
            seen.push(source);
            true
        }
    });

    scored
        .into_iter()
        .enumerate()
        .map(|(i, (candidate, _score))| {
            let confidence = if i == 0 {
                Confidence::Medium
            } else {
                Confidence::Low
            };
            ResolutionCandidate {
                content: candidate.to_source(),
                confidence,
                strategy: ResolutionStrategy::VersionSpaceAlgebra,
            }
        })
        .collect()
}

/// Full VSA resolution pipeline: build space → enumerate → rank → return best.
pub fn resolve_via_vsa(
    scenario: &MergeScenario<&CstNode>,
    max_candidates: usize,
) -> Vec<ResolutionCandidate> {
    let vsa = build_version_space(scenario);
    let candidates = vsa.enumerate(max_candidates);
    rank_candidates(candidates, scenario)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(id: usize, val: &str) -> CstNode {
        CstNode::Leaf {
            id,
            kind: "ident".into(),
            value: val.into(),
        }
    }

    #[test]
    fn test_leaf_conflict_vsa() {
        let base = leaf(1, "x");
        let left = leaf(2, "y");
        let right = leaf(3, "z");
        let scenario = MergeScenario::new(&base, &left, &right);

        let vsa = build_version_space(&scenario);
        let candidates = vsa.enumerate(10);
        // Should have at least left, right, and base as options
        assert!(candidates.len() >= 2);
    }

    #[test]
    fn test_rank_prefers_parents() {
        let base = leaf(1, "x");
        let left = leaf(2, "y");
        let right = leaf(3, "y"); // Both changed to same thing
        let scenario = MergeScenario::new(&base, &left, &right);

        let candidates = resolve_via_vsa(&scenario, 10);
        assert!(!candidates.is_empty());
        // Top candidate should be "y" since both parents agree
        assert_eq!(candidates[0].content, "y");
    }

    #[test]
    fn test_vsa_count() {
        let base = leaf(1, "x");
        let left = leaf(2, "y");
        let right = leaf(3, "z");
        let scenario = MergeScenario::new(&base, &left, &right);

        let vsa = build_version_space(&scenario);
        let count = vsa.count(1000);
        assert!(count.is_some());
        assert!(count.unwrap() >= 2);
    }
}
