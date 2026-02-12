//! Search-Based Software Engineering (SBSE) for merge conflict resolution.
//!
//! Implements the approach from Campos Junior, Ghiotto, de Menezes, Barros,
//! van der Hoek, and Murta (ACM TOSEM, July 2025):
//! "Towards a Feasible Evaluation Function for Search-Based Merge Conflict Resolution"
//!
//! The key insight is that a correct merge resolution preserves characteristics
//! of both conflict parents (left and right), so we can use **parent similarity**
//! as a fitness function to guide a search over candidate resolutions.
//!
//! Search operators:
//! - **Line interleaving**: combine lines from left and right in different orders
//! - **Line selection**: pick each line from either left or right
//! - **Chunking**: take contiguous chunks from each side
//!
//! The fitness function evaluates candidates using:
//! - Token-level Jaccard similarity to left parent
//! - Token-level Jaccard similarity to right parent
//! - Penalty for divergence from base (to avoid reverting changes)

use std::collections::HashSet;

use crate::types::{Confidence, MergeScenario, ResolutionCandidate, ResolutionStrategy};

/// Configuration for the search-based resolver.
pub struct SearchConfig {
    /// Maximum number of candidates to generate.
    pub max_candidates: usize,
    /// Maximum number of generations for the genetic search.
    pub max_generations: usize,
    /// Population size per generation.
    pub population_size: usize,
    /// Weight for left-parent similarity in fitness [0, 1].
    pub left_weight: f64,
    /// Weight for right-parent similarity in fitness [0, 1].
    pub right_weight: f64,
    /// Penalty weight for base similarity [0, 1].
    pub base_penalty: f64,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            max_candidates: 50,
            max_generations: 20,
            population_size: 30,
            left_weight: 0.45,
            right_weight: 0.45,
            base_penalty: 0.1,
        }
    }
}

/// Run search-based conflict resolution.
///
/// Generates candidate resolutions by combining lines from left and right,
/// then scores them using parent similarity as the fitness function.
pub fn search_resolve(
    scenario: &MergeScenario<&str>,
    config: &SearchConfig,
) -> Vec<ResolutionCandidate> {
    let left_lines: Vec<&str> = scenario.left.lines().collect();
    let right_lines: Vec<&str> = scenario.right.lines().collect();
    let _base_lines: Vec<&str> = scenario.base.lines().collect();

    // Generate initial population using different strategies
    let mut population: Vec<String> = Vec::new();

    // Strategy 1: Take left then right
    population.push(format!("{}\n{}", scenario.left, scenario.right));

    // Strategy 2: Take right then left
    population.push(format!("{}\n{}", scenario.right, scenario.left));

    // Strategy 3: Take only left
    population.push(scenario.left.to_string());

    // Strategy 4: Take only right
    population.push(scenario.right.to_string());

    // Strategy 5: Line-by-line interleaving
    let interleaved = interleave_lines(&left_lines, &right_lines);
    population.push(interleaved);

    // Strategy 6: Chunk-based combinations
    let chunks = generate_chunk_combinations(&left_lines, &right_lines);
    population.extend(chunks);

    // Strategy 7: Line selection (pick each line from left or right)
    let selections = generate_line_selections(&left_lines, &right_lines);
    population.extend(selections);

    // Run evolutionary search for additional generations
    for _gen in 0..config.max_generations {
        let mut new_pop = Vec::new();
        for i in 0..population.len() {
            for j in (i + 1)..population.len() {
                if new_pop.len() >= config.population_size {
                    break;
                }
                // Crossover: combine halves of two candidates
                let child = crossover(&population[i], &population[j]);
                new_pop.push(child);
            }
            if new_pop.len() >= config.population_size {
                break;
            }
        }

        // Mutate: swap random lines
        for candidate in &population {
            if new_pop.len() >= config.population_size {
                break;
            }
            let mutated = mutate_swap(candidate);
            new_pop.push(mutated);
        }

        // Evaluate and select best
        population.extend(new_pop);
        population = select_best(
            population,
            scenario,
            config,
            config.population_size,
        );
    }

    // Final scoring and ranking
    let mut scored: Vec<(String, f64)> = population
        .into_iter()
        .map(|candidate| {
            let score = fitness(&candidate, scenario, config);
            (candidate, score)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate
    let mut seen = HashSet::new();
    scored.retain(|(c, _)| seen.insert(c.clone()));

    scored
        .into_iter()
        .take(config.max_candidates)
        .map(|(content, _score)| ResolutionCandidate {
            content,
            confidence: Confidence::Low,
            strategy: ResolutionStrategy::SearchBased,
        })
        .collect()
}

/// Parent similarity fitness function (Campos Junior et al., TOSEM 2025).
///
/// Scores a candidate by how well it preserves content from both parents
/// while incorporating their changes (diverging from base).
fn fitness(candidate: &str, scenario: &MergeScenario<&str>, config: &SearchConfig) -> f64 {
    let left_sim = jaccard_similarity(candidate, scenario.left);
    let right_sim = jaccard_similarity(candidate, scenario.right);
    let base_sim = jaccard_similarity(candidate, scenario.base);

    config.left_weight * left_sim + config.right_weight * right_sim
        - config.base_penalty * base_sim
}

/// Token-level Jaccard similarity between two strings.
fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let tokens_a: HashSet<&str> = a.split_whitespace().collect();
    let tokens_b: HashSet<&str> = b.split_whitespace().collect();

    if tokens_a.is_empty() && tokens_b.is_empty() {
        return 1.0;
    }

    let intersection = tokens_a.intersection(&tokens_b).count() as f64;
    let union = tokens_a.union(&tokens_b).count() as f64;

    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

/// Interleave lines from two sequences.
fn interleave_lines(left: &[&str], right: &[&str]) -> String {
    let mut result = Vec::new();
    let max_len = left.len().max(right.len());
    for i in 0..max_len {
        if i < left.len() {
            result.push(left[i]);
        }
        if i < right.len() && (i >= left.len() || left[i] != right[i]) {
            result.push(right[i]);
        }
    }
    result.join("\n")
}

/// Generate chunk-based combinations.
fn generate_chunk_combinations(left: &[&str], right: &[&str]) -> Vec<String> {
    let mut results = Vec::new();
    if left.is_empty() || right.is_empty() {
        return results;
    }

    // Split at various midpoints and combine
    for split in 1..left.len() {
        let combo = format!(
            "{}\n{}",
            left[..split].join("\n"),
            right[split.min(right.len())..].join("\n")
        );
        results.push(combo);
    }

    for split in 1..right.len() {
        let combo = format!(
            "{}\n{}",
            right[..split].join("\n"),
            left[split.min(left.len())..].join("\n")
        );
        results.push(combo);
    }

    results
}

/// Generate line selections (pick each line from left or right).
fn generate_line_selections(left: &[&str], right: &[&str]) -> Vec<String> {
    let mut results = Vec::new();
    let n = left.len().min(right.len());

    if n == 0 {
        return results;
    }

    // Limit to avoid exponential blowup: use greedy heuristic patterns
    // Pattern: prefer left except where right differs significantly
    let mut prefer_left = Vec::new();
    let mut prefer_right = Vec::new();
    for i in 0..n {
        prefer_left.push(left[i]);
        prefer_right.push(right[i]);
    }
    results.push(prefer_left.join("\n"));
    results.push(prefer_right.join("\n"));

    // Alternating pattern
    let mut alternating = Vec::new();
    for i in 0..n {
        if i % 2 == 0 {
            alternating.push(left[i]);
        } else {
            alternating.push(right[i]);
        }
    }
    results.push(alternating.join("\n"));

    results
}

/// Simple crossover: take first half from one parent, second from the other.
fn crossover(a: &str, b: &str) -> String {
    let a_lines: Vec<&str> = a.lines().collect();
    let b_lines: Vec<&str> = b.lines().collect();

    let mid_a = a_lines.len() / 2;
    let mid_b = b_lines.len() / 2;

    let mut result: Vec<&str> = Vec::new();
    result.extend_from_slice(&a_lines[..mid_a]);
    result.extend_from_slice(&b_lines[mid_b..]);
    result.join("\n")
}

/// Simple mutation: swap two adjacent lines.
fn mutate_swap(candidate: &str) -> String {
    let mut lines: Vec<&str> = candidate.lines().collect();
    if lines.len() >= 2 {
        // Swap the middle two lines as a deterministic "mutation"
        let mid = lines.len() / 2;
        lines.swap(mid - 1, mid);
    }
    lines.join("\n")
}

/// Select the best candidates from a population based on fitness.
fn select_best(
    population: Vec<String>,
    scenario: &MergeScenario<&str>,
    config: &SearchConfig,
    target_size: usize,
) -> Vec<String> {
    let mut scored: Vec<(String, f64)> = population
        .into_iter()
        .map(|c| {
            let f = fitness(&c, scenario, config);
            (c, f)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate
    let mut seen = HashSet::new();
    scored.retain(|(c, _)| seen.insert(c.clone()));

    scored.into_iter().take(target_size).map(|(c, _)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jaccard_similarity() {
        assert!((jaccard_similarity("a b c", "a b c") - 1.0).abs() < f64::EPSILON);
        assert!((jaccard_similarity("a b c", "d e f") - 0.0).abs() < f64::EPSILON);
        assert!(jaccard_similarity("a b c", "a b d") > 0.3);
    }

    #[test]
    fn test_search_produces_candidates() {
        let scenario = MergeScenario::new(
            "int x = 1;\nint y = 2;",
            "int x = 10;\nint y = 2;",
            "int x = 1;\nint y = 20;",
        );
        let config = SearchConfig::default();
        let candidates = search_resolve(&scenario, &config);
        assert!(!candidates.is_empty());
    }

    #[test]
    fn test_fitness_prefers_parents() {
        let scenario = MergeScenario::new("old code", "new left code", "new right code");
        let config = SearchConfig::default();

        // A candidate similar to both parents should score higher than one similar to base
        let good = fitness("new left code new right code", &scenario, &config);
        let bad = fitness("old code", &scenario, &config);
        assert!(good > bad);
    }

    #[test]
    fn test_interleave() {
        let left = vec!["a", "b"];
        let right = vec!["c", "d"];
        let result = interleave_lines(&left, &right);
        assert!(result.contains("a"));
        assert!(result.contains("c"));
    }
}
