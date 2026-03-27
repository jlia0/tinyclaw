"use client";

import { use } from "react";
import { redirect } from "next/navigation";

export default function ProjectDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  redirect(`/tasks?project=${id}`);
}
