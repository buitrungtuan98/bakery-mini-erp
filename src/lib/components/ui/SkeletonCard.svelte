<!-- A skeleton loader component that mimics the new standardized card design. -->
<div class="card bg-base-100 shadow-sm border border-base-200">
    <div class="card-body p-4 animate-pulse">
        <!-- Header -->
        <div class="flex justify-between items-start">
            <div>
                <div class="h-5 bg-base-200 rounded w-32 mb-2"></div>
                <div class="h-3 bg-base-200 rounded w-20"></div>
            </div>
            <div class="h-6 bg-base-200 rounded-full w-20"></div>
        </div>

        <div class="divider my-1"></div>

        <!-- Body -->
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div class="h-4 bg-base-200 rounded w-24"></div>
            <div class="h-4 bg-base-200 rounded w-16 ml-auto"></div>

            <div class="h-4 bg-base-200 rounded w-20"></div>
            <div class="h-4 bg-base-200 rounded w-12 ml-auto"></div>
        </div>

        <div class="divider my-1"></div>

        <!-- Footer Actions -->
        <div class="card-actions justify-end">
            <div class="h-6 w-16 bg-base-200 rounded"></div>
        </div>
    </div>
</div>
