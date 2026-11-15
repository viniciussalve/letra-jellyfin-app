import play from "@phosphor-icons/core/assets/fill/play-fill.svg?raw";
import pause from "@phosphor-icons/core/assets/fill/pause-fill.svg?raw";
import skipBack10 from "@phosphor-icons/core/assets/fill/arrow-counter-clockwise-fill.svg?raw";
import skipForward10 from "@phosphor-icons/core/assets/fill/arrow-clockwise-fill.svg?raw";
import speaker from "@phosphor-icons/core/assets/fill/speaker-high-fill.svg?raw";
import speakerMute from "@phosphor-icons/core/assets/fill/speaker-x-fill.svg?raw";
import speakerNone from "@phosphor-icons/core/assets/fill/speaker-none-fill.svg?raw";
import translate from "@phosphor-icons/core/assets/fill/translate-fill.svg?raw";
import quotes from "@phosphor-icons/core/assets/fill/quotes-fill.svg?raw";
import share from "@phosphor-icons/core/assets/fill/share-fill.svg?raw";
import cornersOut from "@phosphor-icons/core/assets/fill/arrows-out-fill.svg?raw";
import cornersIn from "@phosphor-icons/core/assets/fill/arrows-in-fill.svg?raw";
import dotsThree from "@phosphor-icons/core/assets/fill/dots-three-fill.svg?raw";
import xCircle from "@phosphor-icons/core/assets/fill/x-circle-fill.svg?raw";
import check from "@phosphor-icons/core/assets/fill/check-fill.svg?raw";
import upload from "@phosphor-icons/core/assets/fill/upload-simple-fill.svg?raw";
import pencil from "@phosphor-icons/core/assets/fill/pencil-simple-fill.svg?raw";
import trash from "@phosphor-icons/core/assets/fill/trash-fill.svg?raw";
import link from "@phosphor-icons/core/assets/fill/link-fill.svg?raw";
import musicNote from "@phosphor-icons/core/assets/fill/music-note-fill.svg?raw";
import openExternal from "@phosphor-icons/core/assets/fill/arrow-square-out-fill.svg?raw";
import whatsappLogo from "@phosphor-icons/core/assets/fill/whatsapp-logo-fill.svg?raw";
import instagramLogo from "@phosphor-icons/core/assets/fill/instagram-logo-fill.svg?raw";
import xLogo from "@phosphor-icons/core/assets/fill/x-logo-fill.svg?raw";
import bookmarkSimple from "@phosphor-icons/core/assets/regular/bookmark-simple.svg?raw";
import bookmarkSimpleFill from "@phosphor-icons/core/assets/fill/bookmark-simple-fill.svg?raw";

export type IconName =
  | "play" | "pause" | "skip-back-10" | "skip-forward-10" | "speaker" | "speaker-mute" | "speaker-none"
  | "translate" | "quotes" | "share" | "corners-out" | "corners-in" | "dots-three"
  | "x-circle" | "check" | "upload" | "pencil" | "trash" | "link" | "music-note" | "open-external"
  | "whatsapp-logo" | "instagram-logo" | "x-logo" | "bookmark-simple" | "bookmark-simple-fill";

const SVGS: Record<IconName, string> = {
  play,
  pause,
  "skip-back-10": skipBack10,
  "skip-forward-10": skipForward10,
  speaker,
  "speaker-mute": speakerMute,
  "speaker-none": speakerNone,
  translate,
  quotes,
  share,
  "corners-out": cornersOut,
  "corners-in": cornersIn,
  "dots-three": dotsThree,
  "x-circle": xCircle,
  check,
  upload,
  pencil,
  trash,
  link,
  "music-note": musicNote,
  "open-external": openExternal,
  "whatsapp-logo": whatsappLogo,
  "instagram-logo": instagramLogo,
  "x-logo": xLogo,
  "bookmark-simple": bookmarkSimple,
  "bookmark-simple-fill": bookmarkSimpleFill,
};

/** Inline SVG (Phosphor; fill weight, but "bookmark-simple" is the regular outline) that follows the text color and is hidden from assistive tech. */
export function icon(name: IconName): string {
  return SVGS[name].replace("<svg ", '<svg aria-hidden="true" fill="currentColor" ');
}
