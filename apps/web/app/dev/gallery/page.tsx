import { notFound } from "next/navigation";
import { devGalleryEnabled } from "@/lib/config";
import Gallery from "./Gallery";

export const metadata = { title: "Envelope gallery", robots: { index: false } };

export default function Page() {
  if (!devGalleryEnabled()) notFound();
  return <Gallery />;
}
