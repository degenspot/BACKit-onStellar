import { NextRequest, NextResponse } from 'next/server';
import { getUserStakes } from '@/lib/mockDb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const stakes = getUserStakes(address);
    return NextResponse.json({
      data: stakes,
      total: stakes.length,
      page: 1,
      limit: 20
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stakes' },
      { status: 500 }
    );
  }
}
