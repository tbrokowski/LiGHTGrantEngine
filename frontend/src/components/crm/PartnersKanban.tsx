'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { partners as partnersApi } from '@/lib/api';
import { InitialsAvatar } from './PartnerHero';

const STAGES = [
  { key: 'prospect', label: 'Prospect', color: 'border-gray-300', headerBg: 'bg-gray-50', dot: 'bg-gray-400' },
  { key: 'qualified', label: 'Qualified', color: 'border-blue-300', headerBg: 'bg-blue-50', dot: 'bg-blue-400' },
  { key: 'engaged', label: 'Engaged', color: 'border-indigo-300', headerBg: 'bg-indigo-50', dot: 'bg-indigo-400' },
  { key: 'collaborating', label: 'Collaborating', color: 'border-green-300', headerBg: 'bg-green-50', dot: 'bg-green-400' },
  { key: 'alumni', label: 'Alumni', color: 'border-amber-300', headerBg: 'bg-amber-50', dot: 'bg-amber-400' },
];

interface Partner {
  id: string;
  name: string;
  email?: string;
  organization?: string;
  title?: string;
  tags: string[];
  status: string;
  relationship_stage: string;
  next_contact_date?: string;
  h_index?: number;
}

interface PartnersKanbanProps {
  partners: Partner[];
  onRefresh: () => void;
}

function PartnerCard({ partner, index }: { partner: Partner; index: number }) {
  const isOverdue = partner.next_contact_date && new Date(partner.next_contact_date) < new Date();

  return (
    <Draggable draggableId={partner.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white border rounded-xl p-3 shadow-sm cursor-grab active:cursor-grabbing transition-shadow ${
            snapshot.isDragging ? 'shadow-lg rotate-1 border-blue-300' : 'border-gray-200 hover:border-gray-300 hover:shadow'
          }`}
        >
          <div className="flex items-start gap-2 mb-2">
            <InitialsAvatar name={partner.name} size="sm" />
            <div className="flex-1 min-w-0">
              <Link href={`/partners/${partner.id}`} onClick={e => e.stopPropagation()}>
                <p className="text-sm font-semibold text-gray-900 hover:text-blue-600 leading-tight truncate">
                  {partner.name}
                </p>
              </Link>
              {partner.organization && (
                <p className="text-xs text-gray-400 truncate mt-0.5">{partner.organization}</p>
              )}
            </div>
          </div>

          {partner.tags.slice(0, 2).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {partner.tags.slice(0, 2).map(t => (
                <span key={t} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{t}</span>
              ))}
              {partner.tags.length > 2 && (
                <span className="text-xs text-gray-400">+{partner.tags.length - 2}</span>
              )}
            </div>
          )}

          {partner.next_contact_date && (
            <div className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
              {isOverdue ? <AlertTriangle className="w-3 h-3" /> : <CalendarDays className="w-3 h-3" />}
              {new Date(partner.next_contact_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

function buildColumns(partners: Partner[]): Record<string, Partner[]> {
  const cols: Record<string, Partner[]> = {};
  STAGES.forEach(s => { cols[s.key] = []; });
  partners.forEach(p => {
    const stage = p.relationship_stage || 'prospect';
    if (!cols[stage]) cols[stage] = [];
    cols[stage].push(p);
  });
  return cols;
}

export default function PartnersKanban({ partners, onRefresh }: PartnersKanbanProps) {
  const [columns, setColumns] = useState(() => buildColumns(partners));

  // Rebuild columns when partners prop changes (e.g. after refresh)
  useEffect(() => {
    setColumns(buildColumns(partners));
  }, [partners]);

  async function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result;
    if (!destination || (destination.droppableId === source.droppableId && destination.index === source.index)) return;

    const sourceCol = [...(columns[source.droppableId] || [])];
    const destCol = source.droppableId === destination.droppableId ? sourceCol : [...(columns[destination.droppableId] || [])];

    const [moved] = sourceCol.splice(source.index, 1);
    destCol.splice(destination.index, 0, { ...moved, relationship_stage: destination.droppableId });

    setColumns(prev => ({
      ...prev,
      [source.droppableId]: sourceCol,
      [destination.droppableId]: destCol,
    }));

    try {
      await partnersApi.updateStage(draggableId, destination.droppableId);
    } catch {
      onRefresh();
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2 min-h-[500px]">
        {STAGES.map(stage => {
          const stagePartners = columns[stage.key] || [];
          return (
            <div key={stage.key} className={`flex-shrink-0 w-64 border ${stage.color} rounded-xl overflow-hidden flex flex-col`}>
              <div className={`${stage.headerBg} px-3 py-2.5 border-b ${stage.color} flex items-center gap-2`}>
                <div className={`w-2 h-2 rounded-full ${stage.dot}`} />
                <span className="text-xs font-semibold text-gray-700">{stage.label}</span>
                <span className="ml-auto text-xs text-gray-400 bg-white/70 px-1.5 py-0.5 rounded-full">
                  {stagePartners.length}
                </span>
              </div>

              <Droppable droppableId={stage.key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 p-2 space-y-2 transition-colors min-h-[100px] ${snapshot.isDraggingOver ? 'bg-blue-50/50' : 'bg-gray-50/30'}`}
                  >
                    {stagePartners.map((p, i) => (
                      <PartnerCard key={p.id} partner={p} index={i} />
                    ))}
                    {provided.placeholder}
                    {stagePartners.length === 0 && !snapshot.isDraggingOver && (
                      <div className="text-xs text-gray-300 text-center py-8">Drop here</div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
