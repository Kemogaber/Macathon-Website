"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RectQuad } from "@/components/QuadEditor";
import type { JobInit, TableData } from "@/lib/api";

export type Step = "upload" | "review" | "error";

export interface PerPageState {
  rects: RectQuad[];
  activeRect: number;
  detected: boolean;
  recognized: boolean;
}

export type BusyKind =
  | "upload"
  | "detect-one"
  | "detect-all"
  | "confirm-one"
  | "confirm-all";

interface DemoState {
  step: Step;
  files: File[];
  job: JobInit | null;
  pageStates: PerPageState[];
  currentPage: number;
  tables: TableData[];
  errorMsg: string;
  busy: BusyKind | null;
  confirmProgress: number;
}

interface DemoContextValue extends DemoState {
  setStep: (s: Step) => void;
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setJob: (j: JobInit | null) => void;
  setPageStates: React.Dispatch<React.SetStateAction<PerPageState[]>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setTables: React.Dispatch<React.SetStateAction<TableData[]>>;
  setErrorMsg: (s: string) => void;
  setBusy: (b: BusyKind | null) => void;
  setConfirmProgress: (n: number) => void;
  reset: () => void;
  pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobInit | null>(null);
  const [pageStates, setPageStates] = useState<PerPageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [tables, setTables] = useState<TableData[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [confirmProgress, setConfirmProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStep("upload");
    setFiles([]);
    setJob(null);
    setPageStates([]);
    setCurrentPage(0);
    setTables([]);
    setErrorMsg("");
    setBusy(null);
    setConfirmProgress(0);
  }, []);

  const value = useMemo<DemoContextValue>(
    () => ({
      step,
      files,
      job,
      pageStates,
      currentPage,
      tables,
      errorMsg,
      busy,
      confirmProgress,
      setStep,
      setFiles,
      setJob,
      setPageStates,
      setCurrentPage,
      setTables,
      setErrorMsg,
      setBusy,
      setConfirmProgress,
      reset,
      pollRef,
    }),
    [
      step,
      files,
      job,
      pageStates,
      currentPage,
      tables,
      errorMsg,
      busy,
      confirmProgress,
      reset,
    ],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoStore(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoStore must be used inside <DemoProvider>");
  return ctx;
}
