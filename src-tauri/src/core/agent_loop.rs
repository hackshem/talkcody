//! Agent Loop
//!
//! Implements the core agent execution loop that:
//! 1. Builds context from session messages and settings
//! 2. Calls LLM with streaming
//! 3. Handles tool calls and dispatches to platform tools
//! 4. Manages the conversation flow until completion

use crate::core::tools::{ToolContext, ToolDispatchResult, ToolDispatcher, ToolRegistry};
use crate::core::types::*;
use crate::storage::models::*;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// Agent loop configuration
pub struct AgentLoop {
    config: AgentLoopConfig,
    tool_dispatcher: Arc<ToolDispatcher>,
    event_sender: EventSender,
}

/// Context for a single agent loop execution
#[derive(Debug, Clone)]
pub struct AgentLoopContext {
    pub session_id: SessionId,
    pub task_id: RuntimeTaskId,
    pub workspace_root: String,
    pub worktree_path: Option<String>,
    pub settings: TaskSettings,
    pub messages: Vec<Message>,
}

/// Result of agent loop execution
#[derive(Debug, Clone)]
pub enum AgentLoopResult {
    /// Completed successfully with final response
    Completed { message: String },
    /// Waiting for user approval of tool call
    WaitingForApproval { request: ToolRequest },
    /// Waiting for tool result
    WaitingForToolResult { tool_call_id: ToolCallId },
    /// Error occurred
    Error { message: String },
    /// Maximum iterations reached
    MaxIterationsReached,
    /// Cancelled by user
    Cancelled,
}

impl AgentLoop {
    pub fn new(
        config: AgentLoopConfig,
        tool_dispatcher: Arc<ToolDispatcher>,
        event_sender: EventSender,
    ) -> Self {
        Self {
            config,
            tool_dispatcher,
            event_sender,
        }
    }

    /// Run the agent loop for a single iteration
    /// This is a simplified placeholder implementation
    /// Full implementation would integrate with llm/ module
    pub async fn run_iteration(&self, ctx: &AgentLoopContext) -> Result<AgentLoopResult, String> {
        // Build LLM prompt from context
        let _prompt = self.build_prompt(ctx)?;

        // In a full implementation, this would:
        // 1. Call LLM streaming API from llm/ module
        // 2. Stream tokens back via event_sender
        // 3. Detect tool calls in the response
        // 4. Return appropriate result

        // Placeholder: just return completed
        Ok(AgentLoopResult::Completed {
            message: "Agent loop placeholder completed".to_string(),
        })
    }

    /// Handle a tool call request
    pub async fn handle_tool_call(
        &self,
        ctx: &AgentLoopContext,
        request: ToolRequest,
    ) -> Result<ToolResult, String> {
        let tool_context = ToolContext {
            session_id: ctx.session_id.clone(),
            task_id: ctx.task_id.clone(),
            workspace_root: ctx.workspace_root.clone(),
            worktree_path: ctx.worktree_path.clone(),
            settings: ctx.settings.clone(),
        };

        // Check auto-approve settings
        let auto_approve = ctx.settings.auto_approve_edits.unwrap_or(false);

        match self
            .tool_dispatcher
            .dispatch(request, tool_context, auto_approve)
            .await
        {
            Ok(ToolDispatchResult::Completed(result)) => Ok(result),
            Ok(ToolDispatchResult::PendingApproval(request)) => {
                // Emit event for approval required
                let _ = self.event_sender.send(RuntimeEvent::ToolCallRequested {
                    task_id: ctx.task_id.clone(),
                    request,
                });
                Err("Tool requires approval".to_string())
            }
            Err(e) => Err(e),
        }
    }

    /// Execute a tool that was pending approval
    pub async fn execute_approved_tool(
        &self,
        ctx: &AgentLoopContext,
        request: ToolRequest,
    ) -> ToolResult {
        let tool_context = ToolContext {
            session_id: ctx.session_id.clone(),
            task_id: ctx.task_id.clone(),
            workspace_root: ctx.workspace_root.clone(),
            worktree_path: ctx.worktree_path.clone(),
            settings: ctx.settings.clone(),
        };

        let result = self
            .tool_dispatcher
            .execute_approved(request.clone(), tool_context)
            .await;

        // Emit completion event
        let _ = self.event_sender.send(RuntimeEvent::ToolCallCompleted {
            task_id: ctx.task_id.clone(),
            result: result.clone(),
        });

        result
    }

    /// Build LLM prompt from context
    fn build_prompt(&self, ctx: &AgentLoopContext) -> Result<String, String> {
        // In a full implementation, this would:
        // 1. Convert messages to LLM format
        // 2. Add system prompt from agent configuration
        // 3. Add tool definitions if tools are enabled
        // 4. Apply any prompt engineering

        let mut prompt = String::new();

        // Add messages
        for message in &ctx.messages {
            let role_str = match message.role {
                MessageRole::User => "User",
                MessageRole::Assistant => "Assistant",
                MessageRole::System => "System",
                MessageRole::Tool => "Tool",
            };

            let content_str = match &message.content {
                MessageContent::Text { text } => text.clone(),
                MessageContent::ToolCalls { calls } => {
                    format!("Tool calls: {:?}", calls)
                }
                MessageContent::ToolResult { result } => {
                    format!("Tool result: {:?}", result)
                }
            };

            prompt.push_str(&format!("{}: {}\n", role_str, content_str));
        }

        Ok(prompt)
    }

    /// Stream a token to the event channel
    fn stream_token(&self, session_id: &str, token: &str) {
        let _ = self.event_sender.send(RuntimeEvent::Token {
            session_id: session_id.to_string(),
            token: token.to_string(),
        });
    }
}

/// Factory for creating agent loops with different configurations
pub struct AgentLoopFactory;

impl AgentLoopFactory {
    /// Create a standard agent loop
    pub fn create_standard(
        tool_registry: Arc<ToolRegistry>,
        event_sender: EventSender,
    ) -> AgentLoop {
        let config = AgentLoopConfig::default();
        let tool_dispatcher = Arc::new(ToolDispatcher::new(tool_registry));

        AgentLoop::new(config, tool_dispatcher, event_sender)
    }

    /// Create an agent loop with custom configuration
    pub fn create_with_config(
        config: AgentLoopConfig,
        tool_registry: Arc<ToolRegistry>,
        event_sender: EventSender,
    ) -> AgentLoop {
        let tool_dispatcher = Arc::new(ToolDispatcher::new(tool_registry));

        AgentLoop::new(config, tool_dispatcher, event_sender)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_loop() -> (AgentLoop, mpsc::UnboundedReceiver<RuntimeEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let registry = Arc::new(ToolRegistry::create_default().await);
        let dispatcher = Arc::new(ToolDispatcher::new(registry));

        let loop_instance = AgentLoop::new(AgentLoopConfig::default(), dispatcher, tx);

        (loop_instance, rx)
    }

    #[tokio::test]
    async fn test_agent_loop_placeholder() {
        let (agent_loop, _rx) = create_test_loop().await;

        let ctx = AgentLoopContext {
            session_id: "test-session".to_string(),
            task_id: "test-task".to_string(),
            workspace_root: "/tmp".to_string(),
            worktree_path: None,
            settings: TaskSettings::default(),
            messages: vec![],
        };

        let result = agent_loop.run_iteration(&ctx).await;
        assert!(result.is_ok());

        match result.unwrap() {
            AgentLoopResult::Completed { message } => {
                assert!(!message.is_empty());
            }
            _ => panic!("Expected Completed result"),
        }
    }

    #[tokio::test]
    async fn test_build_prompt() {
        let (agent_loop, _rx) = create_test_loop().await;

        let messages = vec![
            Message {
                id: "msg-1".to_string(),
                session_id: "test".to_string(),
                role: MessageRole::User,
                content: MessageContent::Text {
                    text: "Hello".to_string(),
                },
                created_at: 0,
                tool_call_id: None,
                parent_id: None,
            },
            Message {
                id: "msg-2".to_string(),
                session_id: "test".to_string(),
                role: MessageRole::Assistant,
                content: MessageContent::Text {
                    text: "Hi there!".to_string(),
                },
                created_at: 0,
                tool_call_id: None,
                parent_id: None,
            },
        ];

        let ctx = AgentLoopContext {
            session_id: "test-session".to_string(),
            task_id: "test-task".to_string(),
            workspace_root: "/tmp".to_string(),
            worktree_path: None,
            settings: TaskSettings::default(),
            messages,
        };

        let prompt = agent_loop.build_prompt(&ctx).unwrap();
        assert!(prompt.contains("User: Hello"));
        assert!(prompt.contains("Assistant: Hi there!"));
    }
}
