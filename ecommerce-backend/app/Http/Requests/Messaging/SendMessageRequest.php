<?php

namespace App\Http\Requests\Messaging;

use Illuminate\Foundation\Http\FormRequest;

class SendMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // participant check happens in the controller
    }

    public function rules(): array
    {
        return [
            // Neither is individually required — a message can be text-only,
            // attachment-only (an image with no caption), or both — but
            // 'required_without' catches the one case that isn't allowed:
            // a submit with nothing in it at all.
            'body' => ['required_without:attachment', 'nullable', 'string', 'max:2000'],
            'attachment' => [
                'required_without:body',
                'nullable',
                'file',
                'max:10240', // 10MB
                'mimes:jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,ppt,pptx,txt,zip',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'body.required_without' => 'Write a message or attach a file.',
            'attachment.required_without' => 'Write a message or attach a file.',
            'attachment.max' => 'Attachments must not be larger than 10MB.',
            'attachment.mimes' => 'That file type isn\'t supported.',
        ];
    }
}
