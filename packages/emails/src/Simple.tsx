import React from "react";
import { Body, Button, Container, Head, Html, Preview, Text } from "@react-email/components";

/** Plain notes to the sender: verification and failure. */
export default function SimpleEmail({ preview, lines, cta }: { preview: string; lines: string[]; cta?: { href: string; label: string } }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f4efe5", fontFamily: "Georgia, serif", color: "#2a2420", margin: 0 }}>
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "32px 24px" }}>
          {lines.map((l, i) => (
            <Text key={i} style={{ fontSize: 16, lineHeight: "25px", margin: "0 0 14px" }}>{l}</Text>
          ))}
          {cta ? (
            <Button href={cta.href} style={{ backgroundColor: "#2a2420", color: "#fbf6ee", padding: "12px 22px", borderRadius: 3, fontSize: 15, marginTop: 8 }}>
              {cta.label}
            </Button>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
