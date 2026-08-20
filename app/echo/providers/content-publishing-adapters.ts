export interface BlogPublishingAdapter {
  publish(draftId: string): Promise<never>;
}

export interface NewsletterPublishingAdapter {
  send(draftId: string): Promise<never>;
}

// Intentionally empty until real destinations are approved and connected.
export const blogPublishingAdapters: Readonly<Record<string, BlogPublishingAdapter>> = Object.freeze({});
export const newsletterPublishingAdapters: Readonly<Record<string, NewsletterPublishingAdapter>> = Object.freeze({});
