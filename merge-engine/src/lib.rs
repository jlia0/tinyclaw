//! # merge-engine
//!
//! A non-LLM merge conflict resolver that uses program analysis techniques
//! from recent academic research to automatically resolve git merge conflicts.
//!
//! ## Approach
//!
//! The engine applies a pipeline of increasingly sophisticated strategies:
//!
//! 1. **Pattern-based DSL rules** — Matches common conflict patterns
//!    (whitespace-only, identical changes, import unions, adjacent edits)
//!    and resolves them instantly with high confidence.
//!    *Based on: Svyatkovskiy et al., "Can Program Synthesis be Used to Learn
//!    Merge Conflict Resolutions?", ICSE 2021*
//!
//! 2. **Structured merge via tree-sitter CSTs** — Parses code into concrete
//!    syntax trees and performs three-way tree amalgamation, eliminating false
//!    conflicts that arise from formatting changes or reordering.
//!    *Based on: Duarte, Borba, Cavalcanti, "LASTMERGE — A Language-Agnostic
//!    Structured Tool for Code Integration", arXiv 2025;
//!    Neto & Borba, "On the Methodology of Three-Way Structured Merge", JSA 2023*
//!
//! 3. **Version Space Algebra (VSA)** — For remaining conflicts, builds a
//!    compact representation of all possible resolutions by combining edits
//!    from both sides, then enumerates and ranks candidates.
//!    *Based on: Zhu & He, "Conflict Resolution for Structured Merge via
//!    Version Space Algebra", OOPSLA 2018 / AutoMerge*
//!
//! 4. **Search-based resolution with parent similarity** — Uses evolutionary
//!    search (genetic algorithm) over candidate resolutions, scored by a
//!    fitness function that measures token-level similarity to both parents.
//!    *Based on: Campos Junior et al., "Towards a Feasible Evaluation Function
//!    for Search-Based Merge Conflict Resolution", ACM TOSEM, July 2025*
//!
//! ## Supported Languages
//!
//! Tree-sitter-based structured merge supports: Rust, JavaScript, TypeScript,
//! Python, Java, Go, C, C++. Pattern-based and search-based strategies work
//! on any text content.
//!
//! ## Example
//!
//! ```rust
//! use merge_engine::{Resolver, ResolverConfig, Language};
//!
//! let config = ResolverConfig {
//!     language: Some(Language::Rust),
//!     ..Default::default()
//! };
//! let resolver = Resolver::new(config);
//!
//! let result = resolver.resolve_file(
//!     "fn main() { println!(\"hello\"); }",
//!     "fn main() { println!(\"hello world\"); }",
//!     "fn main() { println!(\"hello\"); eprintln!(\"debug\"); }",
//! );
//!
//! println!("All resolved: {}", result.all_resolved);
//! println!("Merged:\n{}", result.merged_content);
//! ```

pub mod amalgamator;
pub mod diff3;
pub mod matcher;
pub mod parser;
pub mod patterns;
pub mod resolver;
pub mod search;
pub mod types;
pub mod vsa;

// Re-export primary public API
pub use resolver::{FileResolverOutput, Resolver, ResolverConfig, ResolverOutput};
pub use types::{
    Confidence, Language, MergeResult, MergeScenario, ResolutionCandidate, ResolutionStrategy,
};
