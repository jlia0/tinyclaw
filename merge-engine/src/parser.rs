//! Tree-sitter CST parser integration.
//!
//! Following LASTMERGE (Duarte, Borba, Cavalcanti — 2025), we parse source code
//! into concrete syntax trees using Tree-sitter. Unlike abstract syntax trees,
//! CSTs preserve all syntactic elements (whitespace, punctuation, comments),
//! enabling faithful source reconstruction.
//!
//! The parser maps Tree-sitter's node representation into our CstNode types,
//! classifying nodes as Leaf (terminal), Constructed (fixed-arity non-terminal),
//! or List (variable-length non-terminal with ordering semantics).

use std::sync::atomic::{AtomicUsize, Ordering};

use crate::types::{CstNode, Language, ListOrdering};

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

fn fresh_id() -> usize {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// Reset the ID counter (for testing determinism).
pub fn reset_ids() {
    NEXT_ID.store(1, Ordering::Relaxed);
}

/// Parse source code into a CstNode tree using tree-sitter.
pub fn parse_to_cst(source: &str, lang: Language) -> Result<CstNode, ParseError> {
    let ts_lang = get_tree_sitter_language(lang)?;
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&ts_lang)
        .map_err(|e| ParseError::LanguageError(e.to_string()))?;

    let tree = parser
        .parse(source, None)
        .ok_or(ParseError::ParseFailed)?;

    let root = tree.root_node();
    Ok(ts_node_to_cst(&root, source.as_bytes()))
}

/// Recursively convert a tree-sitter node to our CstNode representation.
fn ts_node_to_cst(node: &tree_sitter::Node, source: &[u8]) -> CstNode {
    let kind = node.kind().to_string();
    let id = fresh_id();

    if node.child_count() == 0 {
        // Terminal / leaf node
        let value = node
            .utf8_text(source)
            .unwrap_or("")
            .to_string();
        return CstNode::Leaf { id, kind, value };
    }

    // Collect children (including anonymous nodes for whitespace/punctuation fidelity)
    let children: Vec<CstNode> = (0..node.child_count())
        .filter_map(|i| node.child(i))
        .map(|child| ts_node_to_cst(&child, source))
        .collect();

    // Classify as List or Constructed based on node kind.
    // Per LASTMERGE: list nodes have variable-length children of the same kind.
    let ordering = classify_ordering(&kind);

    if is_list_node(&kind) || children.len() > 3 {
        CstNode::List {
            id,
            kind,
            ordering,
            children,
        }
    } else {
        CstNode::Constructed {
            id,
            kind,
            children,
        }
    }
}

/// Determine if a node kind represents an unordered collection.
/// Per LASTMERGE: import blocks and class member lists are unordered because
/// their children can be permuted without affecting semantics.
fn classify_ordering(kind: &str) -> ListOrdering {
    match kind {
        // Import / use declarations — order doesn't matter
        "use_declaration_list" | "import_list" | "import_statement" | "imports" => {
            ListOrdering::Unordered
        }
        // Class/struct member lists — order usually doesn't matter for semantics
        "class_body" | "enum_body" | "interface_body" | "declaration_list" => {
            ListOrdering::Unordered
        }
        // Everything else is ordered by default
        _ => ListOrdering::Ordered,
    }
}

/// Heuristic: nodes that typically hold lists of children.
fn is_list_node(kind: &str) -> bool {
    kind.contains("block")
        || kind.contains("body")
        || kind.contains("list")
        || kind.contains("statements")
        || kind.contains("arguments")
        || kind.contains("parameters")
        || kind.ends_with("_list")
        || kind == "program"
        || kind == "source_file"
        || kind == "module"
        || kind == "translation_unit"
}

/// Get the tree-sitter Language object for a given language.
fn get_tree_sitter_language(lang: Language) -> Result<tree_sitter::Language, ParseError> {
    let lang_ref = match lang {
        Language::Rust => tree_sitter_rust::LANGUAGE,
        Language::JavaScript => tree_sitter_javascript::LANGUAGE,
        Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
        Language::Python => tree_sitter_python::LANGUAGE,
        Language::Java => tree_sitter_java::LANGUAGE,
        Language::Go => tree_sitter_go::LANGUAGE,
        Language::C => tree_sitter_c::LANGUAGE,
        Language::Cpp => tree_sitter_cpp::LANGUAGE,
    };
    Ok(lang_ref.into())
}

#[derive(Debug)]
pub enum ParseError {
    LanguageError(String),
    ParseFailed,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::LanguageError(s) => write!(f, "language error: {}", s),
            ParseError::ParseFailed => write!(f, "parse failed"),
        }
    }
}

impl std::error::Error for ParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rust() {
        let src = "fn main() { let x = 1; }";
        let tree = parse_to_cst(src, Language::Rust).unwrap();
        assert_eq!(tree.kind(), "source_file");
        assert!(!tree.children().is_empty());
    }

    #[test]
    fn test_parse_javascript() {
        let src = "function foo() { return 42; }";
        let tree = parse_to_cst(src, Language::JavaScript).unwrap();
        assert_eq!(tree.kind(), "program");
        assert!(!tree.children().is_empty());
    }

    #[test]
    fn test_leaf_reconstruction() {
        let src = "let x = 1;";
        let tree = parse_to_cst(src, Language::JavaScript).unwrap();
        // Leaves should reconstruct back to original source
        let reconstructed = tree.to_source();
        assert!(reconstructed.contains("let"));
        assert!(reconstructed.contains("x"));
        assert!(reconstructed.contains("1"));
    }
}
