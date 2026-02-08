use crate::llm::ai_services::types::{
    ContextCompactionRequest, ContextCompactionResult, ModelFallbackInfo,
};
use std::time::Duration;

pub struct ContextCompactionService {
    compression_timeout_ms: u64,
}

impl ContextCompactionService {
    pub fn new() -> Self {
        Self {
            compression_timeout_ms: 300_000, // 5 minutes
        }
    }

    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.compression_timeout_ms = timeout_ms;
        self
    }

    /// Compress conversation history using AI
    pub async fn compact_context(
        &self,
        request: ContextCompactionRequest,
    ) -> Result<ContextCompactionResult, String> {
        let start_time = std::time::Instant::now();

        log::info!("Starting AI context compaction");

        if request.conversation_history.trim().is_empty() {
            log::error!("No conversation history provided for compaction");
            return Err("Conversation history is required for compaction".to_string());
        }

        // Get available model for compression
        let model = self.get_available_model_for_compression(&request.model);
        log::info!("Using model for compression: {}", model);

        // Build the prompt with the 8-section template
        let prompt = self.build_compaction_prompt(&request.conversation_history);

        // For now, return empty summary - full implementation would:
        // 1. Make LLM call with timeout
        // 2. Handle streaming response
        // 3. Return compressed summary

        log::info!(
            "Context compaction prompt generated (length: {} chars)",
            prompt.len()
        );

        let duration = start_time.elapsed();
        log::info!(
            "Context compaction preparation completed - Time: {}ms",
            duration.as_millis()
        );

        // Placeholder: return empty result
        Ok(ContextCompactionResult {
            compressed_summary: String::new(),
        })
    }

    /// Get timeout duration
    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.compression_timeout_ms)
    }

    /// Build the compaction prompt with the 8-section template
    fn build_compaction_prompt(&self, conversation_history: &str) -> String {
        format!(
            "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.\n\
             This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.\n\n\
             Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points.\n\n\
             Your summary should include the following sections:\n\n\
             1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail\n\
             2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.\n\
             3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable.\n\
             4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback.\n\
             5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.\n\
             6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.\n\
             7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.\n\
             8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.\n\n\
             Please be comprehensive and technical in your summary. Include specific file paths, function names, error messages, and code patterns that would be essential for maintaining context.\n\n\
             CONVERSATION HISTORY TO SUMMARIZE:\n\
             {}\n\n\
             Please provide a comprehensive structured summary following the 8-section format above.",
            conversation_history
        )
    }

    /// Get the best available model for compression
    fn get_available_model_for_compression(&self, preferred_model: &Option<String>) -> String {
        // Default preferred model
        let default_model = "gemini-2.5-flash-lite";

        let preferred = preferred_model.as_deref().unwrap_or(default_model);

        // For now, return the preferred model
        // Full implementation would:
        // 1. Check if preferred model is available
        // 2. If not, find fallback with largest context window, then cheapest price
        preferred.to_string()
    }

    /// Find fallback model based on context length and pricing
    fn find_fallback_model(&self, _available_models: &[ModelFallbackInfo]) -> Option<String> {
        // Sort by context length (descending), then by price (ascending)
        // Return the best model identifier
        None
    }
}

impl Default for ContextCompactionService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_has_default_timeout() {
        let service = ContextCompactionService::new();
        assert_eq!(service.compression_timeout_ms, 300_000);
    }

    #[test]
    fn with_timeout_changes_timeout() {
        let service = ContextCompactionService::new().with_timeout(60_000);
        assert_eq!(service.compression_timeout_ms, 60_000);
    }

    #[test]
    fn timeout_returns_duration() {
        let service = ContextCompactionService::new().with_timeout(60_000);
        assert_eq!(service.timeout(), Duration::from_secs(60));
    }

    #[test]
    fn build_prompt_contains_all_sections() {
        let service = ContextCompactionService::new();
        let history = "User: Hello\nAI: Hi there!";
        let prompt = service.build_compaction_prompt(history);

        assert!(prompt.contains("Primary Request and Intent"));
        assert!(prompt.contains("Key Technical Concepts"));
        assert!(prompt.contains("Files and Code Sections"));
        assert!(prompt.contains("Errors and fixes"));
        assert!(prompt.contains("Problem Solving"));
        assert!(prompt.contains("All user messages"));
        assert!(prompt.contains("Pending Tasks"));
        assert!(prompt.contains("Current Work"));
    }

    #[test]
    fn build_prompt_contains_analysis_tags() {
        let service = ContextCompactionService::new();
        let prompt = service.build_compaction_prompt("test");

        assert!(prompt.contains("<analysis>"));
    }

    #[test]
    fn build_prompt_includes_conversation_history() {
        let service = ContextCompactionService::new();
        let history = "This is the conversation history";
        let prompt = service.build_compaction_prompt(history);

        assert!(prompt.contains(history));
        assert!(prompt.contains("CONVERSATION HISTORY TO SUMMARIZE:"));
    }

    #[tokio::test]
    async fn compact_fails_with_empty_history() {
        let service = ContextCompactionService::new();
        let request = ContextCompactionRequest {
            conversation_history: "   ".to_string(),
            model: None,
        };

        let result = service.compact_context(request).await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Conversation history is required"));
    }

    #[tokio::test]
    async fn compact_succeeds_with_valid_history() {
        let service = ContextCompactionService::new();
        let request = ContextCompactionRequest {
            conversation_history: "User: How do I implement auth?\nAI: Here's how...".to_string(),
            model: Some("gemini-2.5-flash-lite".to_string()),
        };

        let result = service.compact_context(request).await;

        assert!(result.is_ok());
        // Result is empty for now (no LLM call)
        assert_eq!(result.unwrap().compressed_summary, "");
    }

    #[test]
    fn get_available_model_uses_preferred() {
        let service = ContextCompactionService::new();
        let model = service.get_available_model_for_compression(&Some("custom-model".to_string()));
        assert_eq!(model, "custom-model");
    }

    #[test]
    fn get_available_model_uses_default() {
        let service = ContextCompactionService::new();
        let model = service.get_available_model_for_compression(&None);
        assert_eq!(model, "gemini-2.5-flash-lite");
    }
}
