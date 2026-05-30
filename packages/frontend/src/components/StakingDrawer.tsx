"use client";

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import StakingInterface from './StakingInterface';
import { CallDetailData } from '@/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  call: CallDetailData;
  onStake: (amount: number, side: 'YES' | 'NO') => Promise<void>;
  odds: { yes: number; no: number } | null;
}

export default function StakingDrawer({ isOpen, onClose, call, onStake, odds }: Props) {
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in-out duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-500 sm:duration-700"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-500 sm:duration-700"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-lg">
                  <div className="flex h-full flex-col overflow-y-scroll bg-gray-50/95 backdrop-blur-3xl shadow-2xl">
                    <div className="p-6 sm:p-8 bg-white border-b border-gray-100">
                      <div className="flex items-start justify-between">
                        <div>
                            <Dialog.Title className="text-2xl font-black text-gray-900 leading-tight">
                            Market Staking
                            </Dialog.Title>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Transaction Portal</p>
                        </div>
                        <button
                          onClick={onClose}
                          className="rounded-xl bg-gray-100 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-200 transition-all active:scale-90"
                        >
                          <XMarkIcon className="h-6 w-6" />
                        </button>
                      </div>
                    </div>
                    <div className="relative flex-1 p-6 sm:p-8">
                       <div className="mb-10 p-6 rounded-3xl bg-indigo-600 text-white shadow-xl shadow-indigo-200">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200 mb-2">Market Target</p>
                          <h4 className="text-2xl font-black leading-tight mb-4">{call.condition}</h4>
                          <div className="flex gap-4">
                             <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
                                <span className="text-[10px] font-bold text-indigo-200 block mb-0.5 uppercase tracking-widest leading-none">Price Target</span>
                                <span className="text-sm font-black text-white">${call.conditionJson?.targetPrice?.toLocaleString() || (call.token.price * 1.5).toLocaleString()}</span>
                             </div>
                             <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
                                <span className="text-[10px] font-bold text-indigo-200 block mb-0.5 uppercase tracking-widest leading-none">Pool Cap</span>
                                <span className="text-sm font-black text-white">$100,000</span>
                             </div>
                          </div>
                       </div>
                       
                       <StakingInterface call={call} onStake={onStake} odds={odds} />
                    </div>
                    
                    <div className="p-8 border-t border-gray-100 bg-white/50">
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.1em] text-center">
                            By clicking stake you agree to the protocol&apos;s decentralized settlement mechanisms.
                        </p>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}