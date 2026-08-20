<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ComplaintResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'subject' => $this->subject,
            'details' => $this->details,
            'status' => $this->status,
            'resolution_notes' => $this->resolution_notes,
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),

            'filed_by' => $this->whenLoaded('filedBy', fn () => [
                'id' => $this->filedBy->id,
                'name' => "{$this->filedBy->first_name} {$this->filedBy->last_name}",
                'role' => $this->filedBy->role,
            ]),

            'against' => $this->whenLoaded('against', fn () => $this->against ? [
                'id' => $this->against->id,
                'name' => "{$this->against->first_name} {$this->against->last_name}",
                'role' => $this->against->role,
            ] : null),

            'order_id' => $this->order_id,
        ];
    }
}
