import { Composition } from "remotion";
import { AnimatedBarChart } from "./AnimatedBarChart";

export const RemotionRoot = () => {
  return (
    <Composition
      id="BarChart"
      component={AnimatedBarChart}
      width={1280}
      height={720}
      durationInFrames={150}
      fps={30}
      defaultProps={{
        title: "Quarterly Growth",
        bars: [
          { label: "Alpha", value: 38, color: "#0f766e" },
          { label: "Beta", value: 64, color: "#f97316" },
          { label: "Gamma", value: 82, color: "#2563eb" },
          { label: "Delta", value: 55, color: "#dc2626" },
          { label: "Epsilon", value: 91, color: "#7c3aed" }
        ]
      }}
    />
  );
};
