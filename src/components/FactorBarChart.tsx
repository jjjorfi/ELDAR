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
          borderRadius: 0,
          backgroundColor: factors.map((factor) => {
            if (factor.points > 0) return "rgba(34,197,94,0.9)";
            if (factor.points < 0) return "rgba(239,68,68,0.9)";
            return "rgba(255,191,0,0.75)";
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
            color: "#999999",
            maxRotation: 35,
            minRotation: 35
          },
          grid: {
            color: "rgba(255,255,255,0.07)"
          }
        },
        y: {
          min: 0,
          max: 2,
          ticks: {
            color: "#999999",
            stepSize: 0.5
          },
          grid: {
            color: "rgba(255,255,255,0.07)"
          }
        }
      }
    }),
    []
  );

  return <Bar data={data} options={options} />;
}
