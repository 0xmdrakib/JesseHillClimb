"use client";
import Image from "next/image";
import { HEADS, HeadId } from "@/lib/heads";

export function HeadPicker(props: { value: HeadId; onChange: (v: HeadId) => void }) {
  const { value, onChange } = props;
  return (
    <div className="headPicker">
      {(Object.keys(HEADS) as HeadId[]).map((id) => (
        <button
          key={id}
          className={"headBtn " + (value === id ? "headBtnActive" : "")}
          onClick={() => onChange(id)}
          type="button"
        >
          <Image className="headImg" src={HEADS[id].src} width={34} height={34} alt={HEADS[id].label} />
          {HEADS[id].label}
        </button>
      ))}
    </div>
  );
}
