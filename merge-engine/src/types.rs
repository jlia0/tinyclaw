//! Core types for the merge engine.
//!
//! Based on the structured merge literature (LASTMERGE 2025, AutoMerge/OOPSLA 2018),
//! we model code as concrete syntax trees with three node kinds:
//! - **Leaf**: terminal nodes (identifiers, literals, operators)
//! - **Constructed**: non-terminal with fixed-arity named children
//! - **List**: non-terminal with variable-length children (ordered or unordered)

use std::fmt;
use std::hash::Hash;

/// Unique identifier for a tree node within a merge context.
pub type NodeId = usize;

/// Ordering semantics for list nodes, per LASTMERGE/JDime.
/// Unordered lists (e.g., import blocks, class members) can be freely permuted
/// without changing program semantics, enabling better conflict resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ListOrdering {
    Ordered,
    Unordered,
}

/// A concrete syntax tree node, following the three-kind taxonomy from
/// Zhu & He (OOPSLA 2018) and LASTMERGE (2025).
#[derive(Debug, Clone)]
pub enum CstNode {
    /// Terminal / leaf node — holds the literal text content.
    Leaf {
        id: NodeId,
        kind: String,
        value: String,
    },
    /// Non-terminal with named, fixed-arity children (e.g., if-statement has
    /// condition, consequence, alternative).
    Constructed {
        id: NodeId,
        kind: String,
        children: Vec<CstNode>,
    },
    /// Non-terminal with a variable-length child list (e.g., block of statements,
    /// import list). The ordering tag controls matching strategy.
    List {
        id: NodeId,
        kind: String,
        ordering: ListOrdering,
        children: Vec<CstNode>,
    },
}

impl CstNode {
    pub fn id(&self) -> NodeId {
        match self {
            CstNode::Leaf { id, .. } => *id,
            CstNode::Constructed { id, .. } => *id,
            CstNode::List { id, .. } => *id,
        }
    }

    pub fn kind(&self) -> &str {
        match self {
            CstNode::Leaf { kind, .. } => kind,
            CstNode::Constructed { kind, .. } => kind,
            CstNode::List { kind, .. } => kind,
        }
    }

    pub fn children(&self) -> &[CstNode] {
        match self {
            CstNode::Leaf { .. } => &[],
            CstNode::Constructed { children, .. } => children,
            CstNode::List { children, .. } => children,
        }
    }

    pub fn children_mut(&mut self) -> &mut Vec<CstNode> {
        match self {
            CstNode::Leaf { .. } => panic!("leaf nodes have no children"),
            CstNode::Constructed { children, .. } => children,
            CstNode::List { children, .. } => children,
        }
    }

    pub fn is_leaf(&self) -> bool {
        matches!(self, CstNode::Leaf { .. })
    }

    pub fn leaf_value(&self) -> Option<&str> {
        match self {
            CstNode::Leaf { value, .. } => Some(value),
            _ => None,
        }
    }

    /// Compute the total number of nodes in this subtree.
    pub fn size(&self) -> usize {
        1 + self.children().iter().map(|c| c.size()).sum::<usize>()
    }

    /// Collect all leaf values in pre-order.
    pub fn collect_leaves(&self) -> Vec<&str> {
        let mut leaves = Vec::new();
        self.collect_leaves_inner(&mut leaves);
        leaves
    }

    fn collect_leaves_inner<'a>(&'a self, out: &mut Vec<&'a str>) {
        match self {
            CstNode::Leaf { value, .. } => out.push(value),
            CstNode::Constructed { children, .. } | CstNode::List { children, .. } => {
                for c in children {
                    c.collect_leaves_inner(out);
                }
            }
        }
    }

    /// Reconstruct source text by concatenating all leaves.
    pub fn to_source(&self) -> String {
        self.collect_leaves().join("")
    }

    /// Structural equality (ignores NodeId).
    pub fn structurally_equal(&self, other: &CstNode) -> bool {
        if self.kind() != other.kind() {
            return false;
        }
        match (self, other) {
            (CstNode::Leaf { value: v1, .. }, CstNode::Leaf { value: v2, .. }) => v1 == v2,
            (
                CstNode::Constructed {
                    children: c1, kind: k1, ..
                },
                CstNode::Constructed {
                    children: c2, kind: k2, ..
                },
            ) => {
                k1 == k2
                    && c1.len() == c2.len()
                    && c1.iter().zip(c2.iter()).all(|(a, b)| a.structurally_equal(b))
            }
            (
                CstNode::List {
                    children: c1,
                    ordering: o1,
                    kind: k1,
                    ..
                },
                CstNode::List {
                    children: c2,
                    ordering: o2,
                    kind: k2,
                    ..
                },
            ) => {
                k1 == k2
                    && o1 == o2
                    && c1.len() == c2.len()
                    && c1.iter().zip(c2.iter()).all(|(a, b)| a.structurally_equal(b))
            }
            _ => false,
        }
    }
}

impl fmt::Display for CstNode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_source())
    }
}

/// A matched pair of nodes across two revisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchPair {
    pub left: NodeId,
    pub right: NodeId,
    pub score: usize,
}

/// The three-way merge scenario: base, left, and right revisions.
#[derive(Debug, Clone)]
pub struct MergeScenario<T> {
    pub base: T,
    pub left: T,
    pub right: T,
}

impl<T> MergeScenario<T> {
    pub fn new(base: T, left: T, right: T) -> Self {
        Self { base, left, right }
    }
}

/// The result of a merge operation on a region.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeResult {
    /// Clean merge — no conflict.
    Resolved(String),
    /// Unresolved conflict with both sides preserved.
    Conflict {
        base: String,
        left: String,
        right: String,
    },
}

impl MergeResult {
    pub fn is_resolved(&self) -> bool {
        matches!(self, MergeResult::Resolved(_))
    }

    pub fn is_conflict(&self) -> bool {
        matches!(self, MergeResult::Conflict { .. })
    }

    /// Format as a git-style conflict marker block.
    pub fn to_string_with_markers(&self) -> String {
        match self {
            MergeResult::Resolved(s) => s.clone(),
            MergeResult::Conflict { base, left, right } => {
                let mut out = String::new();
                out.push_str("<<<<<<< LEFT\n");
                out.push_str(left);
                if !left.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("||||||| BASE\n");
                out.push_str(base);
                if !base.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("=======\n");
                out.push_str(right);
                if !right.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str(">>>>>>> RIGHT\n");
                out
            }
        }
    }
}

/// Supported programming languages for tree-sitter parsing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    Rust,
    JavaScript,
    TypeScript,
    Python,
    Java,
    Go,
    C,
    Cpp,
}

impl Language {
    /// Infer language from a file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext {
            "rs" => Some(Language::Rust),
            "js" | "mjs" | "cjs" => Some(Language::JavaScript),
            "ts" | "tsx" => Some(Language::TypeScript),
            "py" => Some(Language::Python),
            "java" => Some(Language::Java),
            "go" => Some(Language::Go),
            "c" | "h" => Some(Language::C),
            "cpp" | "cc" | "cxx" | "hpp" | "hxx" => Some(Language::Cpp),
            _ => None,
        }
    }
}

/// A text-level hunk from diff3.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Diff3Hunk {
    /// All three versions agree.
    Stable(Vec<String>),
    /// Only left changed from base.
    LeftChanged(Vec<String>),
    /// Only right changed from base.
    RightChanged(Vec<String>),
    /// Both changed differently — conflict.
    Conflict {
        base: Vec<String>,
        left: Vec<String>,
        right: Vec<String>,
    },
}

/// Confidence level for an auto-resolution.
/// Ordered Low < Medium < High so that derived Ord works correctly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    /// Low confidence — search-based best guess.
    Low,
    /// Medium confidence — heuristic match.
    Medium,
    /// High confidence — structural or pattern-based proof.
    High,
}

/// A candidate resolution produced by the resolver pipeline.
#[derive(Debug, Clone)]
pub struct ResolutionCandidate {
    pub content: String,
    pub confidence: Confidence,
    pub strategy: ResolutionStrategy,
}

/// Which strategy produced a resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionStrategy {
    /// Standard three-way merge (no conflict).
    Diff3,
    /// Structured tree merge eliminated a false conflict.
    StructuredMerge,
    /// Version Space Algebra enumerated candidates.
    VersionSpaceAlgebra,
    /// Pattern-based DSL rule matched.
    PatternRule,
    /// Search-based with parent similarity fitness.
    SearchBased,
}

impl fmt::Display for ResolutionStrategy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ResolutionStrategy::Diff3 => write!(f, "diff3"),
            ResolutionStrategy::StructuredMerge => write!(f, "structured-merge"),
            ResolutionStrategy::VersionSpaceAlgebra => write!(f, "version-space-algebra"),
            ResolutionStrategy::PatternRule => write!(f, "pattern-rule"),
            ResolutionStrategy::SearchBased => write!(f, "search-based"),
        }
    }
}
