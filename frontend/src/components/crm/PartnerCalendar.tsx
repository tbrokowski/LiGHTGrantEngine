'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarEvent {
  id: string;
  type: 'meeting' | 'follow_up';
  title: string;
  partner_id: string;
  partner_name: string;
  date: Date;
  meeting_type?: string;
  completed?: boolean;
}

interface Partner {
  id: string;
  name: string;
  meetings: { id: string; title: string; scheduled_at?: string; meeting_type: string; completed_at?: string }[];
  next_contact_date?: string;
}

interface PartnerCalendarProps {
  partners: Partner[];
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PartnerCalendar({ partners }: PartnerCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Build events
  const events: CalendarEvent[] = [];
  partners.forEach(p => {
    p.meetings?.forEach(m => {
      if (m.scheduled_at) {
        events.push({
          id: m.id,
          type: 'meeting',
          title: m.title,
          partner_id: p.id,
          partner_name: p.name,
          date: new Date(m.scheduled_at),
          meeting_type: m.meeting_type,
          completed: !!m.completed_at,
        });
      }
    });
    if (p.next_contact_date) {
      events.push({
        id: `followup-${p.id}`,
        type: 'follow_up',
        title: `Follow up with ${p.name}`,
        partner_id: p.id,
        partner_name: p.name,
        date: new Date(p.next_contact_date),
      });
    }
  });

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
    setSelectedDay(null);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
    setSelectedDay(null);
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  function eventsOnDay(day: number) {
    return events.filter(e =>
      e.date.getFullYear() === viewYear &&
      e.date.getMonth() === viewMonth &&
      e.date.getDate() === day
    );
  }

  const selectedEvents = selectedDay ? eventsOnDay(selectedDay) : [];

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-gray-800">{MONTHS[viewMonth]} {viewYear}</h3>
        <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        {/* DOW headers */}
        <div className="grid grid-cols-7 mb-1">
          {DOW.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayEvents = eventsOnDay(day);
            const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const isSelected = selectedDay === day;

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(isSelected ? null : day)}
                className={`relative rounded-lg py-1.5 text-center text-sm transition-colors ${
                  isToday ? 'bg-blue-600 text-white font-semibold' :
                  isSelected ? 'bg-blue-50 text-blue-700 font-medium' :
                  'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {day}
                {dayEvents.length > 0 && (
                  <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                    {dayEvents.slice(0, 3).map((e, idx) => (
                      <div key={idx}
                        className={`w-1 h-1 rounded-full ${
                          e.type === 'meeting' ? 'bg-purple-500' :
                          new Date(e.date) < today ? 'bg-red-500' : 'bg-blue-400'
                        } ${isToday ? 'bg-white/80' : ''}`}
                      />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected day events */}
        {selectedDay && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              {MONTHS[viewMonth]} {selectedDay}
            </h4>
            {selectedEvents.length === 0 ? (
              <p className="text-xs text-gray-400">No events on this day.</p>
            ) : (
              <div className="space-y-1.5">
                {selectedEvents.map(e => (
                  <Link key={e.id} href={`/partners/${e.partner_id}`}
                    className={`flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 ${e.completed ? 'opacity-50' : ''}`}>
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      e.type === 'meeting' ? 'bg-purple-500' :
                      e.date < today ? 'bg-red-500' : 'bg-blue-400'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{e.title}</p>
                      <p className="text-xs text-gray-400 truncate">{e.partner_name}</p>
                      {e.date.getHours() !== 0 && (
                        <p className="text-xs text-gray-400">
                          {e.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    {e.completed && <span className="text-xs text-green-600 ml-auto shrink-0">✓</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-50">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <div className="w-2 h-2 bg-purple-500 rounded-full" />Meeting
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <div className="w-2 h-2 bg-blue-400 rounded-full" />Follow-up
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <div className="w-2 h-2 bg-red-500 rounded-full" />Overdue
          </div>
        </div>
      </div>
    </div>
  );
}
