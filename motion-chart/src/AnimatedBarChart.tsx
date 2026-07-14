import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type BarDatum = {
  label: string;
  value: number;
  color: string;
};

type AnimatedBarChartProps = {
  title: string;
  bars: BarDatum[];
};

export const AnimatedBarChart = ({ title, bars }: AnimatedBarChartProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
        padding: 64
      }}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
          flexDirection: "column",
          borderRadius: 32,
          background: "rgba(255, 255, 255, 0.88)",
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.12)",
          padding: "48px 56px"
        }}
      >
        <div
          style={{
            fontSize: 24,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#475569"
          }}
        >
          Animated chart
        </div>
        <h1 style={{ margin: "14px 0 40px", fontSize: 56 }}>{title}</h1>
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            gap: 24,
            paddingBottom: 24,
            borderBottom: "3px solid #cbd5e1"
          }}
        >
          {bars.map((bar, index) => {
            const progress = spring({
              fps,
              frame: frame - index * 5,
              config: {
                damping: 14,
                stiffness: 120
              }
            });
            const height = interpolate(progress, [0, 1], [0, (bar.value / maxValue) * 360], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp"
            });
            const numberOpacity = interpolate(frame, [15 + index * 5, 32 + index * 5], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp"
            });

            return (
              <div
                key={bar.label}
                style={{
                  display: "flex",
                  flex: 1,
                  height: "100%",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center"
                }}
              >
                <div
                  style={{
                    marginBottom: 12,
                    fontSize: 28,
                    fontWeight: 700,
                    opacity: numberOpacity
                  }}
                >
                  {bar.value}
                </div>
                <div
                  style={{
                    width: "100%",
                    maxWidth: 150,
                    height,
                    minHeight: height > 0 ? 12 : 0,
                    borderRadius: "24px 24px 0 0",
                    background: bar.color,
                    boxShadow: `0 18px 32px ${bar.color}33`
                  }}
                />
                <div
                  style={{
                    marginTop: 18,
                    fontSize: 24,
                    fontWeight: 600,
                    color: "#334155"
                  }}
                >
                  {bar.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
