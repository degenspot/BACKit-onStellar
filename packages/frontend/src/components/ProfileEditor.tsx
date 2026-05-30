"use client";

import { useState, useEffect, useRef, Fragment, useCallback } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Check, Loader2, X, User, FileText, Upload, ZoomIn, Info } from "lucide-react";
import { truncateAddress } from "@/lib/utils";

interface ProfileEditorProps {
  userAddress: string;
  initialDisplayName: string;
  initialBio: string;
  initialAvatarUrl: string | null;
  onClose: () => void;
}

export function ProfileEditor({
  userAddress,
  initialDisplayName,
  initialBio,
  initialAvatarUrl,
  onClose,
}: ProfileEditorProps) {
  // Form states
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  
  // Cropper states
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [croppedAvatar, setCroppedAvatar] = useState<string | null>(null);

  // Status states
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // Canvas cropping helper
  const updateCroppedImage = useCallback(() => {
    const img = imageRef.current;
    if (!img || !imageSrc) return;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cropSize = 160;
    const destSize = 256;
    
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (natW === 0 || natH === 0) return;
    
    // Fit into cropBox via 'cover'
    const ratio = Math.max(cropSize / natW, cropSize / natH);
    const fitW = natW * ratio;
    const fitH = natH * ratio;
    
    // Apply zoom
    const w = fitW * zoom;
    const h = fitH * zoom;
    
    // Center alignment in CSS
    const x = (cropSize - w) / 2 + offset.x;
    const y = (cropSize - h) / 2 + offset.y;
    
    const scale = destSize / cropSize;
    
    ctx.clearRect(0, 0, destSize, destSize);
    
    // Fill background with white in case of transparent images
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, destSize, destSize);
    
    ctx.drawImage(
      img,
      0, 0, natW, natH,
      x * scale, y * scale, w * scale, h * scale
    );
    
    const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCroppedAvatar(croppedDataUrl);
  }, [imageSrc, zoom, offset]);

  // Update crop preview when image is loaded, dragged, or zoomed
  useEffect(() => {
    if (imageSrc) {
      // Delay slightly to allow the DOM/image to update
      const timer = setTimeout(() => {
        updateCroppedImage();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [imageSrc, zoom, offset, updateCroppedImage]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setErrorMessage("Image size must be less than 2MB");
        setStatus("error");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setImageSrc(reader.result as string);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setCroppedAvatar(null);
        setStatus("idle");
        setErrorMessage("");
      };
      reader.readAsDataURL(file);
    }
  };

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    dragStart.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragStart.current = {
        x: e.touches[0].clientX - offset.x,
        y: e.touches[0].clientY - offset.y,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStart.current || e.touches.length !== 1) return;
    setOffset({
      x: e.touches[0].clientX - dragStart.current.x,
      y: e.touches[0].clientY - dragStart.current.y,
    });
  };

  const handleTouchEnd = () => {
    dragStart.current = null;
  };

  // Save profile
  const handleSave = async () => {
    // Validate Display Name
    if (!displayName.trim()) {
      setStatus("error");
      setErrorMessage("Display name cannot be empty");
      return;
    }
    if (displayName.length > 50) {
      setStatus("error");
      setErrorMessage("Display name cannot exceed 50 characters");
      return;
    }
    if (bio.length > 500) {
      setStatus("error");
      setErrorMessage("Bio cannot exceed 500 characters");
      return;
    }

    try {
      setStatus("saving");
      setErrorMessage("");

      const finalAvatar = croppedAvatar || avatarUrl;

      const res = await fetch("/users/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: userAddress,
          displayName: displayName.trim(),
          bio: bio.trim(),
          avatarUrl: finalAvatar,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save profile");
      }

      setStatus("idle");
      onClose();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to save profile. Try again.");
    }
  };

  // Discard changes
  const handleCancel = () => {
    onClose();
  };

  return (
    <Transition.Root appear show={true} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleCancel}>
        {/* Backdrop overlay */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 text-left align-middle shadow-2xl transition-all p-6 text-slate-100">
                
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                  <div>
                    <Dialog.Title className="text-xl font-bold text-white tracking-tight">
                      Edit Profile
                    </Dialog.Title>
                    <p className="text-xs text-slate-400 font-mono mt-1">
                      {truncateAddress(userAddress)}
                    </p>
                  </div>
                  <button
                    onClick={handleCancel}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Error Banner */}
                {status === "error" && (
                  <div className="mb-4 p-3 bg-red-950/50 border border-red-500/50 rounded-lg text-red-200 text-sm flex items-start gap-2 animate-fadeIn">
                    <Info className="w-4 h-4 mt-0.5 text-red-400 flex-shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Main Two-Column Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                  
                  {/* Left Column: Form & Cropper */}
                  <div className="md:col-span-7 space-y-6">
                    
                    {/* Display Name Input */}
                    <div>
                      <label className="flex items-center justify-between text-sm font-semibold text-slate-200 mb-2">
                        <span className="flex items-center gap-2">
                          <User className="w-4 h-4 text-primary-500" />
                          Display Name
                        </span>
                        <span className={`text-xs ${displayName.length > 50 ? "text-red-400 font-bold" : "text-slate-500"}`}>
                          {displayName.length}/50
                        </span>
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        maxLength={55} // Allow slightly more to trigger validation error
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Choose a display name"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-slate-600"
                      />
                    </div>

                    {/* Bio Textarea */}
                    <div>
                      <label className="flex items-center justify-between text-sm font-semibold text-slate-200 mb-2">
                        <span className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary-500" />
                          Bio
                        </span>
                        <span className={`text-xs ${bio.length > 500 ? "text-red-400 font-bold" : "text-slate-500"}`}>
                          {bio.length}/500
                        </span>
                      </label>
                      <textarea
                        value={bio}
                        maxLength={510} // Allow slightly more to trigger validation error
                        onChange={(e) => setBio(e.target.value)}
                        rows={4}
                        placeholder="Tell the community about yourself..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-slate-600 resize-none"
                      />
                    </div>

                    {/* Avatar Upload / Cropper */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-200 mb-2">
                        Profile Avatar
                      </label>
                      
                      <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950 p-4 border border-slate-800 rounded-lg">
                        
                        {/* File Upload Trigger */}
                        <div className="flex flex-col items-center justify-center">
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="image/*"
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex flex-col items-center justify-center w-24 h-24 rounded-lg border-2 border-dashed border-slate-700 hover:border-primary-500 hover:bg-slate-900/50 transition-all text-slate-400 hover:text-white"
                          >
                            <Upload className="w-5 h-5 mb-1.5" />
                            <span className="text-[10px] font-medium text-center px-1">Upload Photo</span>
                          </button>
                        </div>

                        {/* Interactive Image Cropper (if image uploaded) */}
                        {imageSrc ? (
                          <div className="flex-1 w-full flex flex-col items-center gap-2">
                            <div className="text-[11px] text-slate-400 self-start flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Drag inside the square to position, slide to zoom
                            </div>
                            
                            <div className="flex items-center gap-4 w-full">
                              {/* Crop Frame container */}
                              <div
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                onTouchStart={handleTouchStart}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                                className="relative w-40 h-40 overflow-hidden bg-slate-900 border border-slate-700 rounded-lg cursor-move select-none flex-shrink-0"
                              >
                                <img
                                  ref={imageRef}
                                  src={imageSrc}
                                  alt="Source Crop"
                                  draggable={false}
                                  className="absolute max-w-none max-h-none pointer-events-none select-none"
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                                    transformOrigin: "center center",
                                  }}
                                  onLoad={updateCroppedImage}
                                />
                                {/* Square crop overlay border indicator */}
                                <div className="absolute inset-0 pointer-events-none border border-primary-500/50 rounded-lg" />
                              </div>

                              {/* Zoom Slider controls */}
                              <div className="flex-1 flex flex-col justify-center gap-2">
                                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                                  <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Zoom: {zoom.toFixed(1)}x</span>
                                </div>
                                <input
                                  type="range"
                                  min="1"
                                  max="3"
                                  step="0.05"
                                  value={zoom}
                                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setImageSrc(null);
                                    setCroppedAvatar(null);
                                  }}
                                  className="text-xs text-red-400 hover:text-red-300 self-start transition-colors"
                                >
                                  Clear Image
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 text-xs text-slate-500 py-4">
                            Upload a JPEG or PNG image (max 2MB). Crop it into a perfect square profile icon.
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Right Column: Live Profile Card Preview */}
                  <div className="md:col-span-5 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-800 pt-6 md:pt-0 md:pl-6">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
                        Live Preview Card
                      </h3>
                      
                      {/* Mini Profile Card */}
                      <div className="w-full bg-slate-950/70 border border-slate-800/80 rounded-2xl p-6 relative overflow-hidden backdrop-blur-md shadow-lg">
                        
                        {/* Decorative Background Blur */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-emerald-500/10 to-blue-500/10 rounded-full blur-xl pointer-events-none" />
                        
                        <div className="flex flex-col items-center text-center">
                          {/* Live Avatar Preview */}
                          <div className="relative mb-4">
                            <div className="w-20 h-20 bg-slate-800 rounded-full overflow-hidden flex items-center justify-center border-2 border-primary-500/60 shadow-md">
                              {croppedAvatar || avatarUrl ? (
                                <img
                                  src={croppedAvatar || avatarUrl || ""}
                                  alt="Card Avatar"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <User className="w-10 h-10 text-slate-500" />
                              )}
                            </div>
                            {/* Online badge */}
                            <span className="absolute bottom-0 right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-slate-950 rounded-full" />
                          </div>

                          {/* Live Display Name */}
                          <div className="text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
                            {displayName.trim() || "Anonymous User"}
                          </div>

                          {/* Truncated Address */}
                          <div className="text-xs text-slate-500 font-mono mt-1">
                            {truncateAddress(userAddress)}
                          </div>

                          {/* User Badge */}
                          <div className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary-950/40 text-primary-400 border border-primary-800/50">
                            Stellar Forecaster
                          </div>

                          {/* Divider */}
                          <div className="w-full border-t border-slate-900/60 my-4" />

                          {/* Live Bio */}
                          <div className="w-full text-xs text-slate-400 break-words line-clamp-3 leading-relaxed">
                            {bio.trim() || "No biography provided yet. Add one to let other traders know about you."}
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* Actions Button Panel */}
                    <div className="mt-8 pt-4 border-t border-slate-850 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={status === "saving"}
                        className="flex-1 py-2.5 border border-slate-700 hover:border-white rounded-lg text-sm font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={status === "saving"}
                        className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-lg text-sm font-semibold shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {status === "saving" ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Changes"
                        )}
                      </button>
                    </div>

                  </div>

                </div>

              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
