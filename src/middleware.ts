import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
    const basicAuth = req.headers.get('authorization');

    // Use values from environment variables or provide fallback (NOT recommended for production)
    const user = process.env.BASIC_AUTH_USER || 'admin';
    const pwd = process.env.BASIC_AUTH_PASSWORD || 'secret';

    if (!basicAuth) {
        return new NextResponse('Auth Required', {
            status: 401,
            headers: {
                'WWW-Authenticate': 'Basic realm="Secure Area"',
            },
        });
    }

    const authValue = basicAuth.split(' ')[1];
    const [providedUser, providedPwd] = atob(authValue).split(':');

    if (providedUser === user && providedPwd === pwd) {
        return NextResponse.next();
    }

    return new NextResponse('Unauthorized', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="Secure Area"',
        },
    });
}

// Ensure the middleware is applied to API routes and page routes.
// Exclude static files and images to prevent unnecessary overhead.
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - /api/oauth (OAuth callbacks like Twitter/Threads shouldn't be blocked by basic auth)
         */
        '/((?!_next/static|_next/image|favicon.ico|api/oauth).*)',
    ],
};
