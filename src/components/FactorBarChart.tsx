"use client";

import { useMemo } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";
import { Bar } from "react-chartjs-2";

import type { FactorResult } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface FactorBarChartProps {
  factors: FactorResult[];
}

export function FactorBarChart({ factors }: FactorBarChartProps): JSX.Element {
  const data = useMemo<ChartData<"bar">>(() => {
    return {
      labels: factors.map((factor) => factor.factor),
      datasets: [
        {
          label: "Factor Points",
          data: factors.map((factor) => factor.points),
          borderRadius: 6,
          backgroundColor: factors.map((factor) => {
            if (factor.points > 0) return "rgba(229,231,235,0.86)";
            if (factor.points < 0) return "rgba(107,114,128,0.75)";
            return "rgba(148,163,184,0.75)";
          })
        }
      ]
    };
  }, [factors]);

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = typeof context.parsed.y === "number" ? context.parsed.y : 0;
              return `Points: ${value > 0 ? `+${value}` : value}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#d1d5db",
            maxRotation: 35,
            minRotation: 35
          },
          grid: {
            color: "rgba(229,231,235,0.08)"
          }
        },
        y: {
          min: 0,
          max: 2,
          ticks: {
            color: "#d1d5db",
            stepSize: 0.5
          },
          grid: {
            color: "rgba(229,231,235,0.08)"
          }
        }
      }
    }),
    []
  );

  return <Bar data={data} options={options} />;
}
