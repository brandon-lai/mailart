import { notFound } from "next/navigation";
import { devGalleryEnabled } from "@/lib/config";
import Gallery from "./Gallery";

export const dynamic = "force-dynamic"; // ENABLE_DEV_GALLERY is read per request, not baked in at build
export const metadata = { title: "Envelope gallery", robots: { index: false } };

export default function Page() {
  if (!devGalleryEnabled()) notFound();
  return <Gallery />;
}
