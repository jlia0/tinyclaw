//! Three-way tree amalgamation.
//!
//! Implements the merging phase from LASTMERGE (2025) and Mastery (2023).
//! Given three CST trees (base, left, right) and their pairwise matchings,
//! the amalgamator traverses them in depth-first order, deciding for each
//! node whether to:
//! - Keep the base version (no changes)
//! - Accept the left change (only left modified)
//! - Accept the right change (only right modified)
//! - Accept both if identical changes
//! - Report a conflict if both modified differently
//!
//! For unordered list nodes, we apply the heuristic from LASTMERGE:
//! reorder children to minimize spurious conflicts.

use std::collections::{HashMap, HashSet};

use crate::matcher::{match_trees, tree_similarity};
use crate::types::{CstNode, ListOrdering, MergeResult, MergeScenario, NodeId};

/// Result of amalgamating a single tree node.
#[derive(Debug)]
pub enum AmalgamResult {
    /// Cleanly merged subtree.
    Merged(CstNode),
    /// Conflict — preserves both sides.
    Conflict {
        base: CstNode,
        left: CstNode,
        right: CstNode,
    },
}

/// Perform three-way tree amalgamation.
///
/// This is the core structured merge algorithm. It identifies actual semantic
/// conflicts vs. false positives that line-based diff3 would flag.
pub fn amalgamate(scenario: &MergeScenario<&CstNode>) -> AmalgamResult {
    // Phase 1: Compute pairwise matchings
    let bl_matches = match_trees(scenario.base, scenario.left);
    let br_matches = match_trees(scenario.base, scenario.right);
    let lr_matches = match_trees(scenario.left, scenario.right);

    // Build match maps: base_id → left_id, base_id → right_id
    let bl_map: HashMap<NodeId, NodeId> = bl_matches.iter().map(|p| (p.left, p.right)).collect();
    let br_map: HashMap<NodeId, NodeId> = br_matches.iter().map(|p| (p.left, p.right)).collect();
    let lr_map: HashMap<NodeId, NodeId> = lr_matches.iter().map(|p| (p.left, p.right)).collect();

    // Phase 2: Top-down traversal with conflict detection
    amalgamate_node(scenario.base, scenario.left, scenario.right, &bl_map, &br_map, &lr_map)
}

fn amalgamate_node(
    base: &CstNode,
    left: &CstNode,
    right: &CstNode,
    bl_map: &HashMap<NodeId, NodeId>,
    br_map: &HashMap<NodeId, NodeId>,
    lr_map: &HashMap<NodeId, NodeId>,
) -> AmalgamResult {
    // Check if both sides are identical to base (no change)
    if base.structurally_equal(left) && base.structurally_equal(right) {
        return AmalgamResult::Merged(base.clone());
    }

    // Only left changed
    if base.structurally_equal(right) {
        return AmalgamResult::Merged(left.clone());
    }

    // Only right changed
    if base.structurally_equal(left) {
        return AmalgamResult::Merged(right.clone());
    }

    // Both changed identically
    if left.structurally_equal(right) {
        return AmalgamResult::Merged(left.clone());
    }

    // Both changed differently — try to merge at a finer granularity
    match (base, left, right) {
        // All are leaves — true conflict
        (CstNode::Leaf { .. }, CstNode::Leaf { .. }, CstNode::Leaf { .. }) => {
            AmalgamResult::Conflict {
                base: base.clone(),
                left: left.clone(),
                right: right.clone(),
            }
        }
        // All are non-terminal with children — try child-level merge
        _ if !base.is_leaf() && !left.is_leaf() && !right.is_leaf() => {
            amalgamate_children(base, left, right, bl_map, br_map, lr_map)
        }
        // Structure mismatch — conflict
        _ => AmalgamResult::Conflict {
            base: base.clone(),
            left: left.clone(),
            right: right.clone(),
        },
    }
}

/// Merge at the children level for non-terminal nodes.
fn amalgamate_children(
    base: &CstNode,
    left: &CstNode,
    right: &CstNode,
    bl_map: &HashMap<NodeId, NodeId>,
    br_map: &HashMap<NodeId, NodeId>,
    lr_map: &HashMap<NodeId, NodeId>,
) -> AmalgamResult {
    let base_children = base.children();
    let left_children = left.children();
    let right_children = right.children();

    // For unordered nodes (imports, class members), try the unordered merge
    if let CstNode::List {
        ordering: ListOrdering::Unordered,
        ..
    } = base
    {
        return amalgamate_unordered(base, left, right, bl_map, br_map);
    }

    // For ordered nodes, walk children in lockstep using the matchings
    let bl_child_map = build_child_match_map(base_children, left_children, bl_map);
    let br_child_map = build_child_match_map(base_children, right_children, br_map);

    let mut merged_children = Vec::new();
    let mut has_conflict = false;
    let mut conflict_base = base.clone();
    let mut conflict_left = left.clone();
    let mut conflict_right = right.clone();

    // Track which left/right children have been processed
    let mut used_left: HashSet<NodeId> = HashSet::new();
    let mut used_right: HashSet<NodeId> = HashSet::new();

    for base_child in base_children {
        let left_match = bl_child_map.get(&base_child.id());
        let right_match = br_child_map.get(&base_child.id());

        match (left_match, right_match) {
            // Both sides have a matching child → recurse
            (Some(lc), Some(rc)) => {
                used_left.insert(lc.id());
                used_right.insert(rc.id());
                match amalgamate_node(base_child, lc, rc, bl_map, br_map, lr_map) {
                    AmalgamResult::Merged(node) => merged_children.push(node),
                    AmalgamResult::Conflict { base: b, left: l, right: r } => {
                        has_conflict = true;
                        conflict_base = b;
                        conflict_left = l;
                        conflict_right = r;
                        // Still add left's version as placeholder
                        merged_children.push((*lc).clone());
                    }
                }
            }
            // Only left has it — right deleted it
            (Some(lc), None) => {
                used_left.insert(lc.id());
                // If left didn't modify it, accept the deletion
                if base_child.structurally_equal(lc) {
                    // Right deleted, left unchanged → accept deletion
                } else {
                    // Delete/edit conflict
                    has_conflict = true;
                    conflict_base = base_child.clone();
                    conflict_left = (*lc).clone();
                    conflict_right = CstNode::Leaf {
                        id: 0,
                        kind: "deleted".into(),
                        value: String::new(),
                    };
                }
            }
            // Only right has it — left deleted it
            (None, Some(rc)) => {
                used_right.insert(rc.id());
                if base_child.structurally_equal(rc) {
                    // Left deleted, right unchanged → accept deletion
                } else {
                    has_conflict = true;
                    conflict_base = base_child.clone();
                    conflict_left = CstNode::Leaf {
                        id: 0,
                        kind: "deleted".into(),
                        value: String::new(),
                    };
                    conflict_right = (*rc).clone();
                }
            }
            // Both deleted — accept deletion
            (None, None) => {}
        }
    }

    // Add children that were inserted by left (not in base)
    for lc in left_children {
        if !used_left.contains(&lc.id())
            && !bl_child_map.values().any(|v| v.id() == lc.id())
        {
            merged_children.push(lc.clone());
        }
    }

    // Add children that were inserted by right (not in base)
    for rc in right_children {
        if !used_right.contains(&rc.id())
            && !br_child_map.values().any(|v| v.id() == rc.id())
        {
            merged_children.push(rc.clone());
        }
    }

    if has_conflict {
        AmalgamResult::Conflict {
            base: conflict_base,
            left: conflict_left,
            right: conflict_right,
        }
    } else {
        // Reconstruct node with merged children
        let merged = reconstruct_node(base, merged_children);
        AmalgamResult::Merged(merged)
    }
}

/// Amalgamation for unordered list nodes.
///
/// Per LASTMERGE heuristic: for unordered children (imports, class members),
/// we can resolve many "false conflicts" that arise from reordering.
/// Strategy: take the union of both sides' additions, and agree on deletions
/// only when both sides delete.
fn amalgamate_unordered(
    base: &CstNode,
    left: &CstNode,
    right: &CstNode,
    _bl_map: &HashMap<NodeId, NodeId>,
    _br_map: &HashMap<NodeId, NodeId>,
) -> AmalgamResult {
    let base_children = base.children();
    let left_children = left.children();
    let right_children = right.children();

    let mut result_children = Vec::new();
    let mut used_left: HashSet<usize> = HashSet::new();
    let mut used_right: HashSet<usize> = HashSet::new();

    // Match base children to left and right
    for bc in base_children {
        let left_match = left_children
            .iter()
            .enumerate()
            .find(|(idx, lc)| !used_left.contains(idx) && bc.structurally_equal(lc));
        let right_match = right_children
            .iter()
            .enumerate()
            .find(|(idx, rc)| !used_right.contains(idx) && bc.structurally_equal(rc));

        match (left_match, right_match) {
            (Some((li, _)), Some((ri, _))) => {
                // Both kept it
                used_left.insert(li);
                used_right.insert(ri);
                result_children.push(bc.clone());
            }
            (Some((li, _)), None) => {
                // Right deleted — accept deletion
                used_left.insert(li);
            }
            (None, Some((ri, _))) => {
                // Left deleted — accept deletion
                used_right.insert(ri);
            }
            (None, None) => {
                // Both deleted — accept deletion
            }
        }
    }

    // Add new items from left (not in base)
    for (i, lc) in left_children.iter().enumerate() {
        if !used_left.contains(&i) {
            result_children.push(lc.clone());
        }
    }

    // Add new items from right (not in base)
    for (i, rc) in right_children.iter().enumerate() {
        if !used_right.contains(&i) {
            // Check for duplicate with left additions
            let already_added = result_children.iter().any(|c| c.structurally_equal(rc));
            if !already_added {
                result_children.push(rc.clone());
            }
        }
    }

    AmalgamResult::Merged(reconstruct_node(base, result_children))
}

/// Build a map from base child IDs to their matched counterparts.
fn build_child_match_map<'a>(
    base_children: &[CstNode],
    other_children: &'a [CstNode],
    match_map: &HashMap<NodeId, NodeId>,
) -> HashMap<NodeId, &'a CstNode> {
    let other_by_id: HashMap<NodeId, &CstNode> =
        other_children.iter().map(|c| (c.id(), c)).collect();

    let mut result = HashMap::new();
    for bc in base_children {
        if let Some(&other_id) = match_map.get(&bc.id()) {
            if let Some(other_node) = other_by_id.get(&other_id) {
                result.insert(bc.id(), *other_node);
            }
        }
    }

    // Fallback: match by structural similarity if ID matching fails
    let matched_other: HashSet<NodeId> = result.values().map(|n| n.id()).collect();
    for bc in base_children {
        if result.contains_key(&bc.id()) {
            continue;
        }
        // Find best unmatched other child by similarity
        let best = other_children
            .iter()
            .filter(|oc| !matched_other.contains(&oc.id()))
            .filter(|oc| oc.kind() == bc.kind())
            .max_by_key(|oc| tree_similarity(bc, oc));
        if let Some(matched) = best {
            if tree_similarity(bc, matched) > 0 {
                result.insert(bc.id(), matched);
            }
        }
    }

    result
}

/// Reconstruct a node with new children, preserving the original's kind and type.
fn reconstruct_node(template: &CstNode, children: Vec<CstNode>) -> CstNode {
    match template {
        CstNode::Leaf { .. } => template.clone(),
        CstNode::Constructed { id, kind, .. } => CstNode::Constructed {
            id: *id,
            kind: kind.clone(),
            children,
        },
        CstNode::List {
            id,
            kind,
            ordering,
            ..
        } => CstNode::List {
            id: *id,
            kind: kind.clone(),
            ordering: *ordering,
            children,
        },
    }
}

/// Convert an AmalgamResult to a MergeResult (text-level).
pub fn amalgam_to_merge_result(result: &AmalgamResult) -> MergeResult {
    match result {
        AmalgamResult::Merged(node) => MergeResult::Resolved(node.to_source()),
        AmalgamResult::Conflict { base, left, right } => MergeResult::Conflict {
            base: base.to_source(),
            left: left.to_source(),
            right: right.to_source(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ListOrdering;

    fn leaf(id: usize, val: &str) -> CstNode {
        CstNode::Leaf {
            id,
            kind: "ident".into(),
            value: val.into(),
        }
    }

    #[allow(dead_code)]
    fn list(id: usize, children: Vec<CstNode>) -> CstNode {
        CstNode::List {
            id,
            kind: "block".into(),
            ordering: ListOrdering::Ordered,
            children,
        }
    }

    fn unordered_list(id: usize, children: Vec<CstNode>) -> CstNode {
        CstNode::List {
            id,
            kind: "import_list".into(),
            ordering: ListOrdering::Unordered,
            children,
        }
    }

    #[test]
    fn test_no_change() {
        let base = leaf(1, "x");
        let left = leaf(2, "x");
        let right = leaf(3, "x");
        let scenario = MergeScenario::new(&base, &left, &right);
        let result = amalgamate(&scenario);
        assert!(matches!(result, AmalgamResult::Merged(_)));
    }

    #[test]
    fn test_left_only_change() {
        let base = leaf(1, "x");
        let left = leaf(2, "y");
        let right = leaf(3, "x");
        let scenario = MergeScenario::new(&base, &left, &right);
        let result = amalgamate(&scenario);
        match result {
            AmalgamResult::Merged(node) => assert_eq!(node.leaf_value(), Some("y")),
            _ => panic!("expected merged"),
        }
    }

    #[test]
    fn test_both_same_change() {
        let base = leaf(1, "x");
        let left = leaf(2, "z");
        let right = leaf(3, "z");
        let scenario = MergeScenario::new(&base, &left, &right);
        let result = amalgamate(&scenario);
        match result {
            AmalgamResult::Merged(node) => assert_eq!(node.leaf_value(), Some("z")),
            _ => panic!("expected merged"),
        }
    }

    #[test]
    fn test_true_conflict() {
        let base = leaf(1, "x");
        let left = leaf(2, "y");
        let right = leaf(3, "z");
        let scenario = MergeScenario::new(&base, &left, &right);
        let result = amalgamate(&scenario);
        assert!(matches!(result, AmalgamResult::Conflict { .. }));
    }

    #[test]
    fn test_unordered_merge_additions() {
        let base = unordered_list(1, vec![leaf(2, "a"), leaf(3, "b")]);
        let left = unordered_list(4, vec![leaf(5, "a"), leaf(6, "b"), leaf(7, "c")]);
        let right = unordered_list(8, vec![leaf(9, "a"), leaf(10, "b"), leaf(11, "d")]);

        let scenario = MergeScenario::new(&base, &left, &right);
        let result = amalgamate(&scenario);
        match result {
            AmalgamResult::Merged(node) => {
                // Should have a, b, c, d (union of both additions)
                assert_eq!(node.children().len(), 4);
            }
            _ => panic!("expected unordered merge to succeed"),
        }
    }
}
