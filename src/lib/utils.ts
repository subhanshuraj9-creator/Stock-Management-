import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Job } from "../types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getJobCode(job: { id: string; jobNo?: number }, allJobs?: { id: string; date: number }[]): string {
  if (job.jobNo !== undefined && job.jobNo !== null) {
    return job.jobNo.toString().padStart(4, '0');
  }
  if (allJobs && allJobs.length > 0) {
    const sorted = [...allJobs].sort((a, b) => a.date - b.date);
    const index = sorted.findIndex(j => j.id === job.id);
    if (index !== -1) {
      return (index + 1).toString().padStart(4, '0');
    }
  }
  return job.id.slice(-4).toUpperCase();
}
