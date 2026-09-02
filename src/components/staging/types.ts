import type { Marker } from "@/lib/edits";
import type { FinishInput } from "@/lib/recording/use-recorder";
import type { BubbleConfig, FrameConfig, RecordingMode } from "@/lib/recording/types";

/**
 * Everything the staging screen needs from the recorder. It owns no capture
 * state of its own: the two raw object URLs, the take's facts, and the two
 * callbacks that end staging.
 */
export interface StagingProps {
  mode: RecordingMode;
  screenUrl: string | null;
  cameraUrl: string | null;
  durationMs: number;
  cameraOffsetMs: number;
  markers: Marker[];
  defaults: { bubble: BubbleConfig; frame: FrameConfig };
  error: string;
  onFinish: (input: FinishInput) => void;
  onDiscard: () => void;
}
