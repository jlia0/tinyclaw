//! AST matching algorithms for three-way structured merge.
//!
//! Implements the matching phase from LASTMERGE (2025) and Mastery (2023):
//! - **Ordered matching**: Yang's algorithm (dynamic programming, O(n²))
//!   for children of ordered list/constructed nodes.
//! - **Unordered matching**: Bipartite maximum weight matching (O(n³))
//!   for children of unordered list nodes (imports, class members).
//!
//! The matching phase produces a set of MatchPairs linking corresponding
//! nodes across two revisions, which the amalgamation phase then uses
//! to determine what changed.

use std::collections::HashMap;

use crate::types::{CstNode, ListOrdering, MatchPair, NodeId};

/// Compute the maximum matching between children of two parent nodes.
/// Dispatches to ordered (Yang's) or unordered (bipartite) algorithm
/// based on the parent's ordering semantics.
pub fn match_children(
    left_parent: &CstNode,
    right_parent: &CstNode,
    ordering: ListOrdering,
) -> Vec<MatchPair> {
    let left_children = left_parent.children();
    let right_children = right_parent.children();

    match ordering {
        ListOrdering::Ordered => yang_match(left_children, right_children),
        ListOrdering::Unordered => bipartite_match(left_children, right_children),
    }
}

/// Recursively compute matches between two trees, returning all matched pairs.
pub fn match_trees(left: &CstNode, right: &CstNode) -> Vec<MatchPair> {
    let mut pairs = Vec::new();
    match_trees_recursive(left, right, &mut pairs);
    pairs
}

fn match_trees_recursive(left: &CstNode, right: &CstNode, pairs: &mut Vec<MatchPair>) {
    // Nodes can only match if they have the same kind (LASTMERGE rule)
    if left.kind() != right.kind() {
        return;
    }

    // Leaf-to-leaf match
    if left.is_leaf() && right.is_leaf() {
        if left.leaf_value() == right.leaf_value() {
            pairs.push(MatchPair {
                left: left.id(),
                right: right.id(),
                score: 1,
            });
        }
        return;
    }

    // Can't match leaf to non-leaf
    if left.is_leaf() != right.is_leaf() {
        return;
    }

    // Root nodes match — compute the matching score
    let similarity = tree_similarity(left, right);
    if similarity > 0 {
        pairs.push(MatchPair {
            left: left.id(),
            right: right.id(),
            score: similarity,
        });
    }

    // Determine ordering for child matching
    let ordering = match (left, right) {
        (
            CstNode::List {
                ordering: lo, ..
            },
            CstNode::List { .. },
        ) => *lo,
        _ => ListOrdering::Ordered,
    };

    // Compute child matches
    let child_pairs = match_children(left, right, ordering);

    // Recurse into matched children
    let left_children = left.children();
    let right_children = right.children();

    // Build lookup from matched pairs to recurse into
    let left_map: HashMap<NodeId, &CstNode> =
        left_children.iter().map(|c| (c.id(), c)).collect();
    let right_map: HashMap<NodeId, &CstNode> =
        right_children.iter().map(|c| (c.id(), c)).collect();

    for pair in child_pairs {
        if let (Some(lc), Some(rc)) = (left_map.get(&pair.left), right_map.get(&pair.right)) {
            match_trees_recursive(lc, rc, pairs);
        }
    }
}

/// Yang's algorithm for ordered sequence matching.
///
/// Uses dynamic programming to find the maximum weight matching between
/// two ordered sequences of AST nodes. This is essentially a weighted LCS
/// where the weight of matching two nodes is their subtree similarity.
///
/// Time complexity: O(n * m) where n, m are the lengths of the two sequences.
/// Reference: Yang (1991), "Identifying Syntactic Differences Between Two Programs"
fn yang_match(left: &[CstNode], right: &[CstNode]) -> Vec<MatchPair> {
    let n = left.len();
    let m = right.len();

    if n == 0 || m == 0 {
        return Vec::new();
    }

    // Build DP table: dp[i][j] = max matching score for left[0..i] and right[0..j]
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    let mut choice = vec![vec![0u8; m + 1]; n + 1]; // 0=skip, 1=match, 2=skip-left, 3=skip-right

    for i in 1..=n {
        for j in 1..=m {
            // Option 1: match left[i-1] with right[j-1] if compatible
            let match_score = if can_match(&left[i - 1], &right[j - 1]) {
                dp[i - 1][j - 1] + tree_similarity(&left[i - 1], &right[j - 1])
            } else {
                0
            };

            // Option 2: skip left[i-1]
            let skip_left = dp[i - 1][j];

            // Option 3: skip right[j-1]
            let skip_right = dp[i][j - 1];

            if match_score >= skip_left && match_score >= skip_right && match_score > 0 {
                dp[i][j] = match_score;
                choice[i][j] = 1;
            } else if skip_left >= skip_right {
                dp[i][j] = skip_left;
                choice[i][j] = 2;
            } else {
                dp[i][j] = skip_right;
                choice[i][j] = 3;
            }
        }
    }

    // Trace back to find the matching
    let mut pairs = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 && j > 0 {
        match choice[i][j] {
            1 => {
                pairs.push(MatchPair {
                    left: left[i - 1].id(),
                    right: right[j - 1].id(),
                    score: tree_similarity(&left[i - 1], &right[j - 1]),
                });
                i -= 1;
                j -= 1;
            }
            2 => i -= 1,
            3 => j -= 1,
            _ => break,
        }
    }

    pairs.reverse();
    pairs
}

/// Bipartite maximum weight matching for unordered children.
///
/// Uses the Hungarian algorithm (Kuhn-Munkres) to find the maximum weight
/// matching between two sets of AST nodes. This is appropriate for unordered
/// nodes like import lists or class members where position doesn't matter.
///
/// Time complexity: O(n³) where n = max(|left|, |right|).
/// Reference: LASTMERGE (2025), JDime (Apel et al.)
fn bipartite_match(left: &[CstNode], right: &[CstNode]) -> Vec<MatchPair> {
    let n = left.len();
    let m = right.len();
    if n == 0 || m == 0 {
        return Vec::new();
    }

    // Build similarity matrix
    let size = n.max(m);
    let mut weights = vec![vec![0i64; size]; size];

    for (i, l) in left.iter().enumerate() {
        for (j, r) in right.iter().enumerate() {
            if can_match(l, r) {
                weights[i][j] = tree_similarity(l, r) as i64;
            }
        }
    }

    // Hungarian algorithm for maximum weight matching
    let assignment = hungarian_max(&weights, size);

    let mut pairs = Vec::new();
    for (i, &j) in assignment.iter().enumerate() {
        if i < n && j < m && weights[i][j] > 0 {
            pairs.push(MatchPair {
                left: left[i].id(),
                right: right[j].id(),
                score: weights[i][j] as usize,
            });
        }
    }

    pairs
}

/// Check if two nodes are structurally compatible for matching.
/// Per LASTMERGE: terminal can't match non-terminal, and kinds must be identical.
fn can_match(left: &CstNode, right: &CstNode) -> bool {
    if left.is_leaf() != right.is_leaf() {
        return false;
    }
    left.kind() == right.kind()
}

/// Compute the similarity score between two subtrees.
/// Uses a simple recursive leaf-counting metric:
/// similarity = number of matching leaves in both trees.
pub fn tree_similarity(left: &CstNode, right: &CstNode) -> usize {
    if !can_match(left, right) {
        return 0;
    }

    match (left, right) {
        (CstNode::Leaf { value: v1, .. }, CstNode::Leaf { value: v2, .. }) => {
            if v1 == v2 {
                1
            } else {
                0
            }
        }
        _ => {
            // Count matching leaves between the two subtrees
            let left_leaves = left.collect_leaves();
            let right_leaves = right.collect_leaves();
            lcs_length(&left_leaves, &right_leaves)
        }
    }
}

/// Compute LCS length between two sequences.
fn lcs_length<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            dp[i][j] = if a[i - 1] == b[j - 1] {
                dp[i - 1][j - 1] + 1
            } else {
                dp[i - 1][j].max(dp[i][j - 1])
            };
        }
    }
    dp[n][m]
}

/// Simple Hungarian algorithm for maximum weight matching.
/// Converts to minimum cost by negating, then uses the standard algorithm.
fn hungarian_max(weights: &[Vec<i64>], n: usize) -> Vec<usize> {
    if n == 0 {
        return Vec::new();
    }

    // Convert to cost minimization by finding max and subtracting
    let max_w = weights
        .iter()
        .flat_map(|row| row.iter())
        .copied()
        .max()
        .unwrap_or(0);

    let mut cost = vec![vec![0i64; n]; n];
    for i in 0..n {
        for j in 0..n {
            cost[i][j] = max_w - weights[i][j];
        }
    }

    // Kuhn-Munkres algorithm
    let mut u = vec![0i64; n + 1];
    let mut v = vec![0i64; n + 1];
    let mut p = vec![0usize; n + 1]; // p[j] = row assigned to col j
    let mut way = vec![0usize; n + 1];

    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0usize;
        let mut minv = vec![i64::MAX; n + 1];
        let mut used = vec![false; n + 1];

        loop {
            used[j0] = true;
            let i0 = p[j0];
            let mut delta = i64::MAX;
            let mut j1 = 0usize;

            for j in 1..=n {
                if !used[j] {
                    let cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }

            for j in 0..=n {
                if used[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }

            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }

        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }

    // Extract assignment: result[i] = column assigned to row i
    let mut result = vec![0usize; n];
    for j in 1..=n {
        if p[j] > 0 {
            result[p[j] - 1] = j - 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(id: usize, val: &str) -> CstNode {
        CstNode::Leaf {
            id,
            kind: "identifier".into(),
            value: val.into(),
        }
    }

    #[test]
    fn test_yang_match_identical() {
        let left = vec![leaf(1, "a"), leaf(2, "b"), leaf(3, "c")];
        let right = vec![leaf(4, "a"), leaf(5, "b"), leaf(6, "c")];
        let pairs = yang_match(&left, &right);
        assert_eq!(pairs.len(), 3);
    }

    #[test]
    fn test_yang_match_partial() {
        let left = vec![leaf(1, "a"), leaf(2, "b"), leaf(3, "c")];
        let right = vec![leaf(4, "a"), leaf(5, "c")];
        let pairs = yang_match(&left, &right);
        assert_eq!(pairs.len(), 2);
    }

    #[test]
    fn test_bipartite_match() {
        let left = vec![leaf(1, "a"), leaf(2, "b")];
        let right = vec![leaf(3, "b"), leaf(4, "a")];
        let pairs = bipartite_match(&left, &right);
        assert_eq!(pairs.len(), 2);
    }

    #[test]
    fn test_hungarian_simple() {
        let weights = vec![vec![3, 1], vec![1, 3]];
        let assignment = hungarian_max(&weights, 2);
        // Optimal: row 0→col 0 (3), row 1→col 1 (3) = 6
        assert_eq!(assignment[0], 0);
        assert_eq!(assignment[1], 1);
    }

    #[test]
    fn test_tree_similarity() {
        let a = leaf(1, "hello");
        let b = leaf(2, "hello");
        let c = leaf(3, "world");
        assert_eq!(tree_similarity(&a, &b), 1);
        assert_eq!(tree_similarity(&a, &c), 0);
    }
}
