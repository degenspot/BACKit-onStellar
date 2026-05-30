import { NextRequest, NextResponse } from "next/server";
import { updateUserProfile } from "@/lib/mockDb";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, displayName, bio, avatarUrl } = body;

    const userAddress = address || "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ";

    const updatedProfile = updateUserProfile(userAddress, {
      displayName,
      bio,
      avatarUrl,
    });

    return NextResponse.json({
      success: true,
      profile: updatedProfile.user,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update profile" },
      { status: 500 }
    )
  }
}

// Support OPTIONS for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
