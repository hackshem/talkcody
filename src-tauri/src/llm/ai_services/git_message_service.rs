use crate::llm::ai_services::types::{GitMessageContext, GitMessageResult};

pub struct GitMessageService;

impl GitMessageService {
    pub fn new() -> Self {
        Self
    }

    /// Generate a commit message from git diff
    pub async fn generate_commit_message(
        &self,
        context: GitMessageContext,
    ) -> Result<GitMessageResult, String> {
        log::info!(
            "generateCommitMessage: diffText length = {}",
            context.diff_text.len()
        );

        if context.diff_text.trim().is_empty() {
            log::error!("No diff text provided for commit message generation");
            return Err("No diff text provided".to_string());
        }

        let prompt = self.build_prompt(&context);

        // Return the prompt for now - the actual LLM call will be handled by the caller
        // This allows for better separation of concerns and easier testing
        log::info!(
            "Generated prompt for git commit message (length: {})",
            prompt.len()
        );

        // For now, return an empty result - full implementation would call LLM
        Ok(GitMessageResult {
            message: String::new(),
            suggestions: None,
        })
    }

    /// Build the prompt for commit message generation
    fn build_prompt(&self, context: &GitMessageContext) -> String {
        let user_input_section = context
            .user_input
            .as_ref()
            .map(|input| format!("User task description: \"{}\"\n", input))
            .unwrap_or_default();

        format!(
            "You are an AI assistant that generates concise and meaningful git commit messages following conventional commit format.\n\n\
             {}\
             File changes (git diff):\n\
             {}\n\n\
             Generate a concise git commit message that follows these guidelines:\n\
             1. Use conventional commit format: type(scope): description\n\
             2. Types: feat, fix, docs, style, refactor, test, chore\n\
             3. Keep the message under 72 characters for the subject line\n\
             4. Be specific about what was changed based on the actual diff content\n\
             5. Use imperative mood (e.g., \"add\", \"fix\", \"update\")\n\n\
             Examples:\n\
             - feat(auth): add user authentication system\n\
             - fix(api): resolve data validation error\n\
             - docs: update installation instructions\n\
             - refactor: simplify user service logic\n\n\
             Provide ONLY the commit message without any explanations or formatting.",
            user_input_section, context.diff_text
        )
    }

    /// Get the preferred model for git message generation
    pub fn preferred_model() -> &'static str {
        "gemini-2.5-flash-lite"
    }
}

impl Default for GitMessageService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_includes_diff() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: None,
            diff_text: "diff --git a/file.ts b/file.ts\n+console.log('hello');".to_string(),
        };

        let prompt = service.build_prompt(&context);

        assert!(prompt.contains("diff --git"));
        assert!(prompt.contains("conventional commit format"));
        assert!(!prompt.contains("User task description"));
    }

    #[test]
    fn build_prompt_includes_user_input() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: Some("Fix the login bug".to_string()),
            diff_text: "diff --git a/login.ts b/login.ts\n+if (user) {".to_string(),
        };

        let prompt = service.build_prompt(&context);

        assert!(prompt.contains("Fix the login bug"));
        assert!(prompt.contains("User task description"));
        assert!(prompt.contains("diff --git"));
    }

    #[test]
    fn build_prompt_contains_guidelines() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: None,
            diff_text: "some diff".to_string(),
        };

        let prompt = service.build_prompt(&context);

        assert!(prompt.contains("conventional commit format"));
        assert!(prompt.contains("type(scope): description"));
        assert!(prompt.contains("feat, fix, docs, style, refactor, test, chore"));
        assert!(prompt.contains("72 characters"));
    }

    #[test]
    fn build_prompt_contains_examples() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: None,
            diff_text: "some diff".to_string(),
        };

        let prompt = service.build_prompt(&context);

        assert!(prompt.contains("feat(auth): add user authentication system"));
        assert!(prompt.contains("fix(api): resolve data validation error"));
    }

    #[tokio::test]
    async fn generate_fails_with_empty_diff() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: None,
            diff_text: "   ".to_string(),
        };

        let result = service.generate_commit_message(context).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No diff text"));
    }

    #[tokio::test]
    async fn generate_succeeds_with_valid_diff() {
        let service = GitMessageService::new();
        let context = GitMessageContext {
            user_input: Some("Add new feature".to_string()),
            diff_text: "diff --git a/src/main.ts b/src/main.ts\n+export function newFeature() {}"
                .to_string(),
        };

        let result = service.generate_commit_message(context).await;

        assert!(result.is_ok());
        // Result is empty string for now (no LLM call)
        assert_eq!(result.unwrap().message, "");
    }

    #[test]
    fn preferred_model_returns_gemini() {
        assert_eq!(
            GitMessageService::preferred_model(),
            "gemini-2.5-flash-lite"
        );
    }
}
