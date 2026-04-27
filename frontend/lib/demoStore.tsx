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

interface DemoState {
  step: Step;
  file: File | null;
  job: JobInit | null;
  pageStates: PerPageState[];
  currentPage: number;
  tables: TableData[];
  errorMsg: string;
}

interface DemoContextValue extends DemoState {
  setStep: (s: Step) => void;
  setFile: (f: File | null) => void;
  setJob: (j: JobInit | null) => void;
  setPageStates: React.Dispatch<React.SetStateAction<PerPageState[]>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setTables: React.Dispatch<React.SetStateAction<TableData[]>>;
  setErrorMsg: (s: string) => void;
  reset: () => void;
  pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobInit | null>(null);
  const [pageStates, setPageStates] = useState<PerPageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [tables, setTables] = useState<TableData[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStep("upload");
    setFile(null);
    setJob(null);
    setPageStates([]);
    setCurrentPage(0);
    setTables([]);
    setErrorMsg("");
  }, []);

  const value = useMemo<DemoContextValue>(
    () => ({
      step,
      file,
      job,
      pageStates,
      currentPage,
      tables,
      errorMsg,
      setStep,
      setFile,
      setJob,
      setPageStates,
      setCurrentPage,
      setTables,
      setErrorMsg,
      reset,
      pollRef,
    }),
    [step, file, job, pageStates, currentPage, tables, errorMsg, reset],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoStore(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoStore must be used inside <DemoProvider>");
  return ctx;
}
