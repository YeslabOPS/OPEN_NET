import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  timestamp: Date;
}

interface Conversation {
  id: string;
  agentId: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  currentAgentId: string | null;

  // Actions
  createConversation: (agentId: string, title?: string) => string;
  selectConversation: (conversationId: string) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, 'id'>) => void;
  clearConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  setCurrentAgent: (agentId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      currentConversationId: null,
      currentAgentId: null,

      createConversation: (agentId, title) => {
        const id = `conv_${Date.now()}`;
        const now = new Date();
        const newConversation: Conversation = {
          id,
          agentId,
          title: title || `对话 ${get().conversations.length + 1}`,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          currentConversationId: id,
          currentAgentId: agentId,
        }));

        return id;
      },

      selectConversation: (conversationId) => {
        const conversation = get().conversations.find((c) => c.id === conversationId);
        set({
          currentConversationId: conversationId,
          currentAgentId: conversation?.agentId || null,
        });
      },

      addMessage: (conversationId, message) => {
        const messageWithId: ChatMessage = {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        };

        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [...conv.messages, messageWithId],
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
      },

      clearConversation: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? { ...conv, messages: [], updatedAt: new Date() }
              : conv
          ),
        }));
      },

      deleteConversation: (conversationId) => {
        set((state) => {
          const newConversations = state.conversations.filter(
            (c) => c.id !== conversationId
          );
          return {
            conversations: newConversations,
            currentConversationId:
              state.currentConversationId === conversationId
                ? newConversations[0]?.id || null
                : state.currentConversationId,
          };
        });
      },

      setCurrentAgent: (agentId) => {
        set({ currentAgentId: agentId });
      },
    }),
    {
      name: 'netops-chat-storage',
      partialize: (state) => ({
        conversations: state.conversations,
        currentConversationId: state.currentConversationId,
        currentAgentId: state.currentAgentId,
      }),
    }
  )
);
