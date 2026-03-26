import React from 'react';
import { Composition } from 'remotion';
import { InstallerSplash } from './InstallerSplash';

// 24 frames @ 30 fps = 0.8 s — one seamless spinner rotation.
// Width/height matches the BrowserWindow splash dimensions in src/main.ts.
export const RemotionRoot: React.FC = () => (
  <Composition
    id="InstallerSplash"
    component={InstallerSplash}
    durationInFrames={24}
    fps={30}
    width={360}
    height={200}
  />
);
