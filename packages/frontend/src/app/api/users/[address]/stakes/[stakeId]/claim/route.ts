import { NextRequest, NextResponse } from 'next/server';
import { claimStake } from '@/lib/mockDb';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; stakeId: string }> }
) {
  try {
    const { address, stakeId } = await params;
    const updatedStake = claimStake(address, stakeId);
    return NextResponse.json({
      success: true,
      stake: updatedStake
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to claim stake' },
      { status: 400 }
    );
  }
}
