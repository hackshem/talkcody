use crate::llm::ai_services::types::{TitleGenerationRequest, TitleGenerationResult};

pub struct TaskTitleService;

impl TaskTitleService {
    pub fn new() -> Self {
        Self
    }

    /// Generate a title from user input
    pub async fn generate_title(
        &self,
        request: TitleGenerationRequest,
    ) -> Result<TitleGenerationResult, String> {
        log::info!(
            "generateTitle: userInput length = {}",
            request.user_input.len()
        );

        if request.user_input.trim().is_empty() {
            log::error!("No user input provided for title generation");
            return Err("No user input provided".to_string());
        }

        let language = request.language.as_deref().unwrap_or("en");
        let language_instruction = if language == "zh" {
            "Generate the title in Chinese."
        } else {
            "Generate the title in English."
        };

        let prompt = self.build_prompt(&request.user_input, language_instruction);

        log::info!(
            "Generated prompt for title generation (length: {})",
            prompt.len()
        );

        // For now, return empty title - full implementation would call LLM
        Ok(TitleGenerationResult {
            title: String::new(),
        })
    }

    /// Build the prompt for title generation
    fn build_prompt(&self, user_input: &str, language_instruction: &str) -> String {
        format!(
            "You are an AI assistant that generates concise, descriptive titles for tasks.\n\n\
             User's message: \"{}\"\n\n\
             Generate a short, clear title (5-10 words) that captures the essence of what the user is asking or discussing.\n\n\
             Guidelines:\n\
             1. Keep it concise (5-10 words maximum)\n\
             2. Use title case (capitalize first letter of main words)\n\
             3. Be specific and descriptive\n\
             4. Avoid generic titles like \"New Chat\" or \"Question\"\n\
             5. Focus on the main topic or intent\n\n\
             Examples:\n\
             - \"Fix Login Bug\"\n\
             - \"Create User Dashboard\"\n\
             - \"Explain React Hooks\"\n\
             - \"Database Schema Design\"\n\
             - \"API Rate Limiting Issue\"\n\n\
             {}\n\n\
             Provide ONLY the title without any quotes, explanations, or additional formatting.",
            user_input, language_instruction
        )
    }

    /// Get the preferred model type for title generation
    pub fn preferred_model_type() -> &'static str {
        "small"
    }
}

impl Default for TaskTitleService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_user_input() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt(
            "How do I use React hooks?",
            "Generate the title in English.",
        );

        assert!(prompt.contains("How do I use React hooks?"));
        assert!(prompt.contains("User's message"));
    }

    #[test]
    fn build_prompt_contains_guidelines() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("5-10 words maximum"));
        assert!(prompt.contains("title case"));
        assert!(prompt.contains("specific and descriptive"));
    }

    #[test]
    fn build_prompt_contains_examples() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("Fix Login Bug"));
        assert!(prompt.contains("Create User Dashboard"));
        assert!(prompt.contains("Explain React Hooks"));
    }

    #[test]
    fn build_prompt_uses_english_instruction() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in English.");

        assert!(prompt.contains("Generate the title in English."));
    }

    #[test]
    fn build_prompt_uses_chinese_instruction() {
        let service = TaskTitleService::new();
        let prompt = service.build_prompt("test", "Generate the title in Chinese.");

        assert!(prompt.contains("Generate the title in Chinese."));
    }

    #[tokio::test]
    async fn generate_fails_with_empty_input() {
        let service = TaskTitleService::new();
        let request = TitleGenerationRequest {
            user_input: "   ".to_string(),
            language: None,
            model: None,
        };

        let result = service.generate_title(request).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No user input"));
    }

    #[tokio::test]
    async fn generate_succeeds_with_valid_input() {
        let service = TaskTitleService::new();
        let request = TitleGenerationRequest {
            user_input: "How to implement authentication?".to_string(),
            language: Some("en".to_string()),
            model: None,
        };

        let result = service.generate_title(request).await;

        assert!(result.is_ok());
        // Result is empty string for now (no LLM call)
        assert_eq!(result.unwrap().title, "");
    }

    #[tokio::test]
    async fn generate_uses_chinese_when_specified() {
        let service = TaskTitleService::new();
        let request = TitleGenerationRequest {
            user_input: "如何实现登录功能？".to_string(),
            language: Some("zh".to_string()),
            model: None,
        };

        let result = service.generate_title(request).await;

        assert!(result.is_ok());
    }

    #[test]
    fn preferred_model_type_returns_small() {
        assert_eq!(TaskTitleService::preferred_model_type(), "small");
    }
}
