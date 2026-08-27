import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  persistAiDockCollapsedStorage,
  persistAiDockWidthStorage,
  readAiDockCollapsed,
  readAiDockWidth,
  shouldPersistAiDockWidth,
} from "./aiDockGeometry";

export function useAiDockPanel() {
  const aiDockRef = useRef<PanelImperativeHandle | null>(null);
  const aiDockWidthRef = useRef(readAiDockWidth());
  const aiDockWidthWriteTimerRef = useRef(0);
  const [initialAiDockCollapsed] = useState(readAiDockCollapsed);
  const collapsedRef = useRef(initialAiDockCollapsed);

  const persistAiDockCollapsed = useCallback((collapsed: boolean) => {
    if (collapsedRef.current === collapsed) return;
    collapsedRef.current = collapsed;
    persistAiDockCollapsedStorage(collapsed);
  }, []);

  const persistAiDockWidth = useCallback(
    (next: number, isUserInteraction: boolean) => {
      if (!shouldPersistAiDockWidth(next, isUserInteraction)) return;
      aiDockWidthRef.current = next;
      if (aiDockWidthWriteTimerRef.current) {
        window.clearTimeout(aiDockWidthWriteTimerRef.current);
      }
      aiDockWidthWriteTimerRef.current = window.setTimeout(() => {
        aiDockWidthWriteTimerRef.current = 0;
        persistAiDockWidthStorage(next);
      }, 200);
    },
    [],
  );

  const toggleAiDock = useCallback(() => {
    const p = aiDockRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) p.resize(`${aiDockWidthRef.current}px`);
    else p.collapse();
  }, []);

  const expandAiDock = useCallback(() => {
    const p = aiDockRef.current;
    if (!p) return;
    if (p.getSize().asPercentage <= 0) p.resize(`${aiDockWidthRef.current}px`);
  }, []);

  const collapseAiDock = useCallback(() => {
    aiDockRef.current?.collapse();
  }, []);

  useEffect(() => {
    return () => {
      if (aiDockWidthWriteTimerRef.current) {
        window.clearTimeout(aiDockWidthWriteTimerRef.current);
      }
    };
  }, []);

  return {
    aiDockRef,
    aiDockWidthRef,
    initialAiDockCollapsed,
    persistAiDockCollapsed,
    persistAiDockWidth,
    toggleAiDock,
    expandAiDock,
    collapseAiDock,
  };
}
