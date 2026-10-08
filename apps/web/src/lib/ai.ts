'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { api, uploadFile } from './api';

// The AI layer (docs/ARCHITECTURE.md §80): one assistant in the top bar for every app.

export type PromptApp = 'flow' | 'sheets' | 'slides' | 'docs' | 'general';
export type PromptOutput = 'flow' | 'sheet' | 'deck' | 'photodeck' | 'design' | 'template' | 'image' | 'layers' | 'retext' | 'markdown' | 'text';

export interface AiPrompt {
  key: string;
  name: string;
  app: PromptApp;
  output: PromptOutput;
  description: string;
  system: string;
  template: string;
  temperature: number;
  variables: { name: string; label: string; example: string }[];
  partOf?: string;
  builtIn: boolean;
  overridden: boolean;
  canEdit: boolean;
  updatedAt: string | null;
}

export interface AiModel {
  name: string;
  size: number;
  family: string | null;
  parameters: string | null;
  quantization: string | null;
  vision: boolean;
}

export interface AiStatus {
  enabled: boolean;
  provider: 'ollama';
  url: string;
  reachable: boolean;
  error: string | null;
  models: AiModel[];
  model: string;
  perApp: Record<PromptApp, string>;
  numCtx: number;
  queue: number;
  formats: { id: string; label: string; size: { w: number; h: number }; note: string }[];
  /** Image AI connection (§81). */
  images: { provider: 'none' | 'openai' | 'gemini' | 'demo'; ready: boolean; model: string | null; vision: 'local' | 'gemini'; visionModel: string | null };
}

export interface AiJob {
  id: string;
  promptKey: string;
  output: PromptOutput;
  model: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  request: string;
  result: (Record<string, unknown> & { url?: string; resourceId?: string; title?: string; text?: string; fixes?: string[]; warnings?: string[] }) | null;
  error: string | null;
  partial: string;
  tokens: number;
  elapsedMs: number;
  queuePosition: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImageSettingsView {
  provider: 'none' | 'openai' | 'gemini' | 'demo';
  openaiModel: string;
  openaiBaseUrl?: string;
  geminiModel: string;
  vision: 'local' | 'gemini';
  visionModel: string;
  hasOpenaiKey: boolean;
  hasGeminiKey: boolean;
}
export interface AiSettings {
  enabled: boolean;
  provider: 'ollama';
  url: string;
  model: string;
  models: Partial<Record<PromptApp, string>>;
  numCtx: number;
  images: ImageSettingsView;
}

export const useAiStatus = (enabled = true) => useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/ai/status'), staleTime: 30_000, enabled });
export const useAiPrompts = () => useQuery({ queryKey: ['ai', 'prompts'], queryFn: () => api<AiPrompt[]>('/ai/prompts'), staleTime: 60_000 });
export const useAiJobs = () =>
  useQuery({
    queryKey: ['ai', 'jobs'],
    queryFn: () => api<AiJob[]>('/ai/jobs'),
    // While one of them runs, the list follows it (status, then Open).
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false),
  });
export const useAiSettings = (enabled: boolean) => useQuery({ queryKey: ['ai', 'settings'], queryFn: () => api<AiSettings>('/ai/settings'), enabled });

/** A job, polled while it waits or runs. */
export const useAiJob = (id: string | null) =>
  useQuery({
    queryKey: ['ai', 'job', id],
    queryFn: () => api<AiJob>(`/ai/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && !['queued', 'running'].includes(q.state.data.status) ? false : 1200),
  });

const onError = (e: Error) => toast.error(e.message);

export function useAiActions() {
  const qc = useQueryClient();
  return {
    start: useMutation({
      mutationFn: (b: { promptKey: string; request: string; variables?: Record<string, string>; targetId?: string | null; format?: string | null; model?: string | null; notation?: 'flowchart' | 'bpmn' | null; slideId?: string | null; elementId?: string | null; as?: 'background' | 'element' | null; background?: 'template' | 'ai' | null }) => api<AiJob>('/ai/jobs', { method: 'POST', json: b }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'jobs'] }),
      onError,
    }),
    cancel: useMutation({ mutationFn: (id: string) => api<AiJob>(`/ai/jobs/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }), onError }),
    savePrompt: useMutation({
      mutationFn: ({ key, ...b }: Omit<AiPrompt, 'builtIn' | 'overridden' | 'canEdit' | 'updatedAt' | 'key' | 'partOf'> & { key: string | null }) =>
        key ? api<AiPrompt>(`/ai/prompts/${encodeURIComponent(key)}`, { method: 'PUT', json: b }) : api<AiPrompt>('/ai/prompts', { method: 'POST', json: b }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'prompts'] }),
      onError,
    }),
    deletePrompt: useMutation({ mutationFn: (key: string) => api(`/ai/prompts/${encodeURIComponent(key)}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'prompts'] }), onError }),
    testImages: useMutation({ mutationFn: () => api<{ ok: boolean; provider: string; model: string; bytes: number; ms: number }>('/ai/settings/test-images', { method: 'POST' }), onError }),
    importPicture: useMutation({
      mutationFn: ({ id, file, slideId }: { id?: string | null; file: File; slideId?: string | null }) => {
        const fd = new FormData();
        fd.append('file', file);
        if (slideId) (fd.append('slideId', slideId), fd.append('newSlide', '0'));
        // Without a presentation the picture becomes a new design in its own shape.
        return uploadFile<{ slideId: string; url: string; resourceId?: string }>(id ? `/ai/pictures/${id}/import` : '/ai/pictures/import', fd);
      },
      onError,
    }),
    saveSettings: useMutation({
      mutationFn: (b: Partial<Omit<AiSettings, 'images'>> & { images?: Partial<ImageSettingsView> & { openaiKey?: string; geminiKey?: string } }) => api<AiSettings>('/ai/settings', { method: 'PUT', json: b }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }),
      onError,
    }),
  };
}

// ── The open file, as the assistant sees it ─────────────────────────────────

export interface AiContext {
  app: PromptApp;
  resourceId: string;
  name: string;
  /** Docs: the selected text (or the whole document when nothing is selected). */
  getText?: () => { selection: string; document: string };
  /** Docs: puts Markdown at the cursor, or replaces the selection with text. */
  insert?: (markdown: string, mode: 'insert' | 'replace') => void;
  /** Slides: the slide on screen and the one selected element (pictures work on them). */
  getSlide?: () => { slideId: string | null; elementId: string | null };
  editable: boolean;
}

interface AiUi {
  open: boolean;
  context: AiContext | null;
  /** A request to start with when the panel opens (from a button in an app). */
  preset: { promptKey: string; request?: string } | null;
  setOpen: (v: boolean, preset?: AiUi['preset']) => void;
  setContext: (c: AiContext | null) => void;
}

export const useAiUi = create<AiUi>((set) => ({
  open: false,
  context: null,
  preset: null,
  setOpen: (open, preset = null) => set({ open, preset }),
  setContext: (context) => set({ context }),
}));

export const OUTPUT_LABEL: Record<PromptOutput, string> = { flow: 'Workflow', sheet: 'Workbook', deck: 'Presentation', photodeck: 'Presentation with picture slots', design: 'Free-form design', template: 'Design from a template', image: 'Picture (image AI)', layers: 'Editable text from a picture', retext: 'New information into a design', markdown: 'Text (Markdown)', text: 'Text' };
export const APP_LABEL: Record<PromptApp, string> = { flow: 'Flow', sheets: 'Sheets', slides: 'Slides', docs: 'Docs', general: 'General' };

/** Tells the assistant which file is open (cleared when the editor closes). */
export function useRegisterAi(ctx: AiContext | null) {
  const key = ctx ? `${ctx.app}:${ctx.resourceId}:${ctx.name}:${ctx.editable}` : '';
  const ref = useRef(ctx);
  ref.current = ctx;
  useEffect(() => {
    if (!ref.current) return;
    // Getter functions read the latest editor through the ref.
    const c = ref.current;
    useAiUi.getState().setContext({ ...c, getText: c.getText ? () => ref.current!.getText!() : undefined, insert: c.insert ? (m, mode) => ref.current!.insert!(m, mode) : undefined, getSlide: c.getSlide ? () => ref.current!.getSlide!() : undefined });
    return () => {
      if (useAiUi.getState().context?.resourceId === c.resourceId) useAiUi.getState().setContext(null);
    };
  }, [key]);
}
