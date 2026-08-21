import { z } from "zod";

const publicHttpUrl = z
  .url("Enter a valid website URL.")
  .refine((value) => /^https?:\/\//i.test(value), "Website URL must use HTTP or HTTPS.");

export const bidSubmissionSchema = z.object({
  amount: z.number().finite().positive().max(1_000_000),
  contactEmail: z.email().max(254),
  logoUrl: publicHttpUrl.optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  tagline: z.string().trim().min(3).max(160),
  websiteUrl: publicHttpUrl,
});

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export type BidSubmission = z.infer<typeof bidSubmissionSchema>;
export type BidDecision = z.infer<typeof decisionSchema>["decision"];

export interface PublicPlacement {
  amountCents: number;
  clickCount: number;
  id: string;
  logoUrl: string | null;
  name: string;
  publishedAt: number;
  tagline: string;
  updatedAt: number;
  websiteUrl: string;
}

export interface PublicLeaderboard {
  generatedAt: number;
  ladder: {
    bidIncrementCents: number;
    currency: string;
    description: string;
    minimumBidCents: number;
    name: string;
    refundInitiationBusinessDays: number;
    reviewWindowBusinessDays: number;
    slug: string;
  };
  placements: PublicPlacement[];
}
