import { create } from "zustand"

const useAgentStore = create((set, get) => ({
  // 会话
  sessionId: null,
  sessions: [{ id: "default", title: "新对话" }],
  currentSessionId: "default",

  // 消息
  messages: [],
  isStreaming: false,

  // 计划
  currentPlan: null,
  showPlan: false,

  // 操作
  setSessionId: (id) => set({ sessionId: id }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateLastMessage: (updates) =>
    set((state) => {
      const msgs = [...state.messages]
      if (msgs.length > 0) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...updates }
      }
      return { messages: msgs }
    }),

  setIsStreaming: (v) => set({ isStreaming: v }),

  setCurrentPlan: (plan) => set({ currentPlan: plan }),

  togglePlan: () => set((state) => ({ showPlan: !state.showPlan })),

  clearMessages: () => set({ messages: [], currentPlan: null }),

  newSession: () =>
    set({
      sessionId: null,
      messages: [],
      currentPlan: null,
      currentSessionId: Date.now().toString(),
    }),

  addSession: (title) =>
    set((state) => ({
      sessions: [
        ...state.sessions,
        { id: state.currentSessionId, title },
      ],
    })),
}))

export default useAgentStore
