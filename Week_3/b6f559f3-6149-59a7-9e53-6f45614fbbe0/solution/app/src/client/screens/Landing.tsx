import '../styles/landing.css';
import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';
import { FollowLightStage, useHashScroll } from './landing/FollowLightStage';
import { KindTiles } from './landing/KindTiles';
import { PublishedMarquee } from './landing/Marquee';
import { ThumbnailMosaic } from './landing/Mosaic';
import { ReadoutDemo } from './landing/ReadoutDemo';
import { TimelineDemo } from './landing/TimelineDemo';
import { VariablesDemo } from './landing/VariablesDemo';
import { VersionCard } from './landing/VersionCard';

export function Landing() {
  useHashScroll();
  return (
    <>
      <WorkspaceHeader />
      <main className="landing">
        <FollowLightStage />
        <PublishedMarquee />
        <KindTiles />
        <TimelineDemo />
        <VariablesDemo />
        <ReadoutDemo />
        <VersionCard />
        <ThumbnailMosaic />
      </main>
      <WorkspaceFooter />
    </>
  );
}
