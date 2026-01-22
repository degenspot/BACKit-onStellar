"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CallDetail from "../../../components/CallDetail";

export default function CallDetailPage() {
  const { id } = useParams();
  const [call, setCall] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCall() {
      const res = await fetch(`/api/calls/${id}`);
      const data = await res.json();
      setCall(data);
      setLoading(false);
    }
    fetchCall();
  }, [id]);

  if (loading) return <p className="p-4">Loading…</p>;

  return <CallDetail call={call} />;
}
