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
    () => {
      const values = factors.map((factor) => factor.points);
      const minValue = values.length > 0 ? Math.min(...values, 0) : 0;
      const maxValue = values.length > 0 ? Math.max(...values, 0) : 2;
      return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 180,
        easing: "easeOutCubic"
      },
      interaction: {
        mode: "nearest",
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          displayColors: false,
          titleColor: "#F5F5F5",
          bodyColor: "#F5F5F5",
          backgroundColor: "rgba(15,17,21,0.92)",
          borderColor: "rgba(255,255,255,0.2)",
          borderWidth: 1,
          callbacks: {
            title(context) {
              const label = context[0]?.label ?? "N/A";
              return `X: ${label}`;
            },
            label(context) {
              const value = typeof context.parsed.y === "number" ? context.parsed.y : 0;
              return `Y: ${value > 0 ? `+${value}` : value}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "X Axis",
            color: "#8B8F98",
            font: {
              size: 10,
              weight: 500
            }
          },
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
          min: Math.floor(minValue * 2) / 2,
          max: Math.ceil(maxValue * 2) / 2,
          title: {
            display: true,
            text: "Y Axis",
            color: "#8B8F98",
            font: {
              size: 10,
              weight: 500
            }
          },
          ticks: {
            color: "#999999",
            stepSize: 0.5
          },
          grid: {
            color: "rgba(255,255,255,0.07)"
          }
        }
      }
    };
    },
    [factors]
  );

  return <Bar data={data} options={options} />;
}
