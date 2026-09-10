<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A message can now be an attachment (image or file) instead of, or
     * alongside, text — `body` drops its NOT NULL so an image-only message
     * doesn't need a fake caption. The four `attachment_*` columns are kept
     * denormalized on the message itself (not a separate table) since a
     * message has at most one attachment and this avoids a join on every
     * thread load; `attachment_type` is the cheap discriminator the
     * frontend uses to decide "render an <img>" vs "render a file chip"
     * without sniffing the mime type client-side.
     */
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->text('body')->nullable()->change();
            $table->string('attachment_path')->nullable()->after('body');
            $table->string('attachment_name')->nullable()->after('attachment_path');
            $table->string('attachment_mime')->nullable()->after('attachment_name');
            $table->unsignedBigInteger('attachment_size')->nullable()->after('attachment_mime');
            $table->enum('attachment_type', ['image', 'file'])->nullable()->after('attachment_size');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn(['attachment_path', 'attachment_name', 'attachment_mime', 'attachment_size', 'attachment_type']);
            $table->text('body')->nullable(false)->change();
        });
    }
};
