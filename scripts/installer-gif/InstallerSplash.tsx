import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

// Matches the splash screen content in src/main.ts:
// - 360×200 frame, #1e1f22 background
// - "GOCHAT" title, spinner ring (#5865f2), status text
// Rounded corners are applied by Windows 11 DWM to the live BrowserWindow;
// the GIF is shown inside the Squirrel installer which has its own chrome.
// The spinner completes one full rotation every 24 frames (0.8 s at 30 fps),
// mirroring the CSS `animation: s .8s linear infinite` in the live splash.

export const InstallerSplash: React.FC = () => {
  const frame = useCurrentFrame();
  const rotation = (frame / 24) * 360;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#1e1f22',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        userSelect: 'none',
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 5,
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.85)',
          margin: 0,
          padding: 0,
        }}
      >
        GoChat
      </h1>

      {/* Spinner — identical border style to the live splash */}
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: '2px solid rgba(255, 255, 255, 0.12)',
          borderTopColor: '#5865f2',
          transform: `rotate(${rotation}deg)`,
          boxSizing: 'border-box',
        }}
      />

      <p
        style={{
          fontSize: 11,
          color: 'rgba(255, 255, 255, 0.38)',
          letterSpacing: 0.5,
          margin: 0,
          padding: 0,
        }}
      >
        Installing GoChat…
      </p>
    </AbsoluteFill>
  );
};
