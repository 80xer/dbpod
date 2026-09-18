import type { Environment } from "../../generated/ipc-types";

export const environmentStyles: Record<Environment, { badge: string; header: string; rail: string }> = {
  local: { badge: "bg-gray-100 text-gray-600", header: "bg-white", rail: "bg-gray-500" },
  dev: { badge: "bg-green-100 text-green-800", header: "bg-green-50", rail: "bg-green-700" },
  stage: { badge: "bg-amber-100 text-amber-800", header: "bg-amber-50", rail: "bg-amber-700" },
  prod: { badge: "bg-red-100 text-red-800", header: "bg-red-50", rail: "bg-red-700" },
};
