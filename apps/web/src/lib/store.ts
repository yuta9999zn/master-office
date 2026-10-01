'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ViewMode = 'list' | 'grid' | 'gallery' | 'compact';

interface UiState {
  sidebarCollapsed: boolean;
  detailsOpen: boolean;
  viewMode: ViewMode;
  paletteOpen: boolean;
  toggleSidebar: () => void;
  setDetailsOpen: (v: boolean) => void;
  setViewMode: (v: ViewMode) => void;
  setPaletteOpen: (v: boolean) => void;
}

/** Per-viewer UI conveniences; persisted to localStorage (docs/ARCHITECTURE.md §3.2). */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      detailsOpen: true,
      viewMode: 'list',
      paletteOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
      setViewMode: (viewMode) => set({ viewMode }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: 'mo-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ sidebarCollapsed, detailsOpen, viewMode }) => ({ sidebarCollapsed, detailsOpen, viewMode }),
    },
  ),
);
