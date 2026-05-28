import { useEffect } from "react";

interface MetaTagsProps {
  title: string;
  description: string;
  url: string;
  image?: string;
}

export function useMetaTags({
  title,
  description,
  url,
  image = "/og-default.png",
}: MetaTagsProps) {
  useEffect(() => {
    // Update document title
    document.title = title;

    // Update or create meta tags
    const updateMetaTag = (
      name: string,
      content: string,
      property?: boolean
    ) => {
      let tag = property
        ? document.querySelector(`meta[property="${name}"]`)
        : document.querySelector(`meta[name="${name}"]`);

      if (!tag) {
        tag = document.createElement("meta");
        if (property) {
          tag.setAttribute("property", name);
        } else {
          tag.setAttribute("name", name);
        }
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    // Standard meta tags
    updateMetaTag("description", description);

    // Open Graph tags
    updateMetaTag("og:title", title, true);
    updateMetaTag("og:description", description, true);
    updateMetaTag("og:url", url, true);
    updateMetaTag("og:image", image, true);
    updateMetaTag("og:type", "website", true);
    updateMetaTag("og:site_name", "BACKit", true);

    // Twitter Card tags
    updateMetaTag("twitter:card", "summary_large_image");
    updateMetaTag("twitter:title", title);
    updateMetaTag("twitter:description", description);
    updateMetaTag("twitter:image", image);

    // Canonical link
    let canonical = document.querySelector("link[rel='canonical']");
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", url);
  }, [title, description, url, image]);
}
