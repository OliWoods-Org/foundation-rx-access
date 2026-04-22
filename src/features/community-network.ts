import { z } from "zod";

export const MemberRole = z.enum(["user", "volunteer", "advocate", "moderator", "admin"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const CommunityMember = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  role: MemberRole,
  location: z.object({ lat: z.number(), lng: z.number(), region: z.string() }).optional(),
  skills: z.array(z.string()),
  availableForMentoring: z.boolean().default(false),
  joinedAt: z.date(),
  lastActiveAt: z.date(),
});
export type CommunityMember = z.infer<typeof CommunityMember>;

export const ResourcePost = z.object({
  id: z.string().uuid(),
  authorId: z.string(),
  title: z.string(),
  content: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  upvotes: z.number().default(0),
  verified: z.boolean().default(false),
  createdAt: z.date(),
});
export type ResourcePost = z.infer<typeof ResourcePost>;

export const PeerMatch = z.object({
  id: z.string().uuid(),
  requesterId: z.string(),
  matchedId: z.string(),
  reason: z.string(),
  score: z.number().min(0).max(1),
  status: z.enum(["pending", "accepted", "declined", "active", "completed"]),
  createdAt: z.date(),
});
export type PeerMatch = z.infer<typeof PeerMatch>;

const members = new Map<string, CommunityMember>();
const resources = new Map<string, ResourcePost>();

export function registerMember(name: string, role: MemberRole = "user", skills: string[] = []): CommunityMember {
  const member: CommunityMember = {
    id: crypto.randomUUID(), displayName: name, role, skills,
    availableForMentoring: false, joinedAt: new Date(), lastActiveAt: new Date(),
  };
  members.set(member.id, member);
  return member;
}

export function findMentors(skills: string[]): CommunityMember[] {
  return [...members.values()]
    .filter(m => m.availableForMentoring && m.skills.some(s => skills.includes(s)))
    .sort((a, b) => b.skills.filter(s => skills.includes(s)).length - a.skills.filter(s => skills.includes(s)).length);
}

export function matchPeers(requesterId: string, criteria: { skills?: string[]; region?: string }): PeerMatch[] {
  const requester = members.get(requesterId);
  if (!requester) return [];
  
  return [...members.values()]
    .filter(m => m.id !== requesterId)
    .map(m => {
      let score = 0;
      if (criteria.skills) score += m.skills.filter(s => criteria.skills!.includes(s)).length * 0.3;
      if (criteria.region && m.location?.region === criteria.region) score += 0.4;
      return { id: crypto.randomUUID(), requesterId, matchedId: m.id, reason: "Skill and location match", score: Math.min(score, 1), status: "pending" as const, createdAt: new Date() };
    })
    .filter(m => m.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function postResource(authorId: string, title: string, content: string, category: string, tags: string[] = []): ResourcePost {
  const post: ResourcePost = { id: crypto.randomUUID(), authorId, title, content, category, tags, upvotes: 0, verified: false, createdAt: new Date() };
  resources.set(post.id, post);
  return post;
}

export function searchResources(query: string): ResourcePost[] {
  const q = query.toLowerCase();
  return [...resources.values()].filter(r => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q) || r.tags.some(t => t.toLowerCase().includes(q)));
}
